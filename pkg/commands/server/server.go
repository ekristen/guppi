package server

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/urfave/cli/v3"

	"github.com/ekristen/guppi/pkg/activity"
	"github.com/ekristen/guppi/pkg/auth"
	"github.com/ekristen/guppi/pkg/common"
	"github.com/ekristen/guppi/pkg/identity"
	"github.com/ekristen/guppi/pkg/peer"
	"github.com/ekristen/guppi/pkg/preferences"
	"github.com/ekristen/guppi/pkg/projects"
	"github.com/ekristen/guppi/pkg/server"
	"github.com/ekristen/guppi/pkg/state"
	"github.com/ekristen/guppi/pkg/tlscert"
	"github.com/ekristen/guppi/pkg/tmux"
	"github.com/ekristen/guppi/pkg/toolevents"
	"github.com/ekristen/guppi/pkg/webpush"
)

func Execute(ctx context.Context, c *cli.Command) error {
	// Initialize tmux client
	client, err := tmux.NewClient()
	if err != nil {
		return err
	}

	// Initialize state manager
	stateMgr := state.NewManager(client)
	stateMgr.SetResolver(projects.NewResolver())

	// Initialize tool event tracker
	tracker := toolevents.NewTracker()

	// Initialize activity tracker
	actTracker := activity.NewTracker()

	// Start session discovery in background
	interval := time.Duration(c.Int("discovery-interval")) * time.Second
	discovery := tmux.NewDiscovery(client, interval, func(sessions []*tmux.Session) {
		stateMgr.UpdateSessions(sessions)
	})
	go discovery.Run(ctx)

	// Start tool event reconciler — clears stale notifications when the
	// agent process is no longer running in the pane
	reconciler := toolevents.NewReconciler(tracker, func(paneID string) toolevents.PaneState {
		panes, err := client.ListAllPanes()
		if err != nil {
			return toolevents.PaneState{Exists: false}
		}
		for _, p := range panes {
			if p.ID == paneID {
				return toolevents.PaneState{Exists: true, CurrentCommand: p.CurrentCommand, PID: p.PID}
			}
		}
		return toolevents.PaneState{Exists: false}
	}, 3*time.Second)
	go reconciler.Run(ctx)

	// Start agent detector — scans pane process trees for known agents
	// and records synthetic events for panes without hook-based tracking
	detector := toolevents.NewDetector(tracker, func() []toolevents.PaneInfo {
		panes, err := client.ListAllPanesDetailed()
		if err != nil {
			return nil
		}
		var infos []toolevents.PaneInfo
		for _, p := range panes {
			infos = append(infos, toolevents.PaneInfo{
				PaneID:  p.ID,
				Session: p.Session,
				Window:  p.Window,
				PID:     p.PID,
			})
		}
		return infos
	}, 5*time.Second)
	go detector.Run(ctx)

	// Start silence monitor — detects when non-Claude agents go quiet and
	// inspects pane content for input prompts
	silenceMonitor := toolevents.NewSilenceMonitor(tracker, detector, client)
	go silenceMonitor.Run(ctx)

	// Start control mode for event-driven state updates
	if !c.Bool("no-control-mode") {
		fallbackInterval := 30 * time.Second
		ctrlMode := tmux.NewControlMode(client, func(sessions []*tmux.Session) {
			stateMgr.UpdateSessions(sessions)
		},
			tmux.WithOnConnect(func() {
				discovery.SetInterval(fallbackInterval)
			}),
			tmux.WithOnDisconnect(func() {
				discovery.SetInterval(interval)
			}),
			tmux.WithOnOutput(func(paneID string, dataLen int) {
				session := stateMgr.SessionForPane(paneID)
				if session != "" {
					actTracker.Record(session, dataLen)
				}
				silenceMonitor.RecordOutput(paneID)
			}),
		)
		go ctrlMode.Run(ctx)
	}

	// Start inactivity promoter — generates synthetic "waiting" events for
	// tools that lack native waiting detection (copilot, codex, opencode)
	go tracker.RunInactivityPromoter(ctx, toolevents.DefaultInactivityTimeout)

	// Initialize preferences store
	prefStore, err := preferences.NewStore()
	if err != nil {
		logrus.WithError(err).Warn("failed to load preferences, using defaults")
		// Create a fallback in-memory store with defaults
		prefStore = nil
	}

	// Initialize web push notifications
	var pushKeys *webpush.VAPIDKeys
	var pushStore *webpush.Store
	vapidKeys, err := webpush.LoadOrCreateKeys()
	if err != nil {
		logrus.WithError(err).Warn("failed to load VAPID keys, push notifications will be unavailable")
	} else {
		pushKeys = vapidKeys
		pushStore = webpush.NewStore()
		pushSender := webpush.NewSender(pushKeys, pushStore, tracker)
		go pushSender.Run(ctx)
	}

	// Initialize authentication
	var (
		authEnabled   bool
		passwordStore *auth.PasswordStore
		sessionMgr    *auth.SessionManager
	)
	if !c.Bool("no-auth") {
		passwordStore, err = auth.NewPasswordStore()
		if err != nil {
			return fmt.Errorf("failed to initialize auth: %w", err)
		}
		sessionMgr = auth.NewSessionManager(24 * time.Hour)
		authEnabled = true

		if !passwordStore.HasPassword() {
			logrus.Info("no password set — open the dashboard in your browser to complete setup")
		}
	}

	// Initialize identity for peer system
	hostname, _ := os.Hostname()
	nodeIdentity, err := identity.LoadOrCreate(hostname)
	if err != nil {
		return fmt.Errorf("failed to load identity: %w", err)
	}
	logrus.WithField("name", nodeIdentity.Name).WithField("fingerprint", nodeIdentity.Fingerprint()).Info("node identity loaded")

	peerStore, err := identity.NewPeerStore()
	if err != nil {
		return fmt.Errorf("failed to load peer store: %w", err)
	}

	// Initialize peer manager
	peerMgr := peer.NewManager(nodeIdentity, peerStore, stateMgr)
	go peerMgr.Run()

	// Stamp local host identity on detector and silence monitor so
	// auto-detected events include the host info for multi-host navigation
	detector.SetHost(peerMgr.LocalID(), peerMgr.LocalName())
	silenceMonitor.SetHost(peerMgr.LocalID(), peerMgr.LocalName())

	// Initialize pairing manager
	pairingMgr := identity.NewPairingManager()

	// Initialize PTY relay for remote sessions
	ptyRelay := peer.NewPTYRelay()

	// Initialize peer handler (accepts incoming peer connections)
	peerHandler := peer.NewHandler(peerMgr, peerStore, tracker, pairingMgr, ptyRelay)

	// If --hub is set, connect to the hub as a peer
	hubURL := c.String("hub")
	localOnly := c.Bool("local-only")
	if hubURL != "" {
		peerClient := peer.NewClient(
			hubURL, nodeIdentity, peerStore,
			stateMgr, peerMgr, actTracker, tracker,
			client.TmuxPath(), c.Bool("insecure"),
		)
		go peerClient.Run(ctx)
		logrus.WithField("hub", hubURL).Info("connecting to hub as peer")
	}

	// Initialize TLS
	opts := &server.Options{
		Port:            int(c.Int("port")),
		SocketPath:      c.String("socket"),
		Client:          client,
		StateMgr:        stateMgr,
		Tracker:         tracker,
		ActivityTracker: actTracker,
		PushKeys:        pushKeys,
		PushStore:       pushStore,
		PrefStore:       prefStore,
		AuthEnabled:     authEnabled,
		PasswordStore:   passwordStore,
		SessionMgr:      sessionMgr,
		PeerMgr:         peerMgr,
		PeerHandler:     peerHandler,
		PairingMgr:      pairingMgr,
		PTYRelay:        ptyRelay,
		Detector:        detector,
		LocalOnly:       localOnly,
	}

	if !c.Bool("no-tls") {
		certPath := c.String("tls-cert")
		keyPath := c.String("tls-key")

		// If custom cert/key provided, use those; otherwise auto-generate
		if certPath == "" || keyPath == "" {
			var caCertPEM string
			certPath, keyPath, caCertPEM, err = tlscert.LoadOrGenerate(c.StringSlice("tls-san"))
			if err != nil {
				return fmt.Errorf("failed to setup TLS: %w", err)
			}
			opts.CACertPEM = caCertPEM
		}

		tlsConfig, reloader, err := tlscert.LoadTLSConfigWithReloader(certPath, keyPath)
		if err != nil {
			return fmt.Errorf("failed to load TLS config: %w", err)
		}
		opts.TLSConfig = tlsConfig
		opts.TLSFingerprint = reloader.Fingerprint()
		opts.CertReloader = reloader

		// Start cert file watcher for hot-reload
		reloadInterval := c.Duration("tls-reload-interval")
		go reloader.Watch(ctx, reloadInterval)
	}

	// Pass CA cert to peer handler for pairing responses
	peerHandler.CACertPEM = opts.CACertPEM

	// Start the HTTP server (blocks until ctx is cancelled)
	return server.Run(ctx, opts)
}

func init() {
	flags := []cli.Flag{
		&cli.IntFlag{
			Name:    "port",
			Aliases: []string{"p"},
			Usage:   "HTTP server port",
			Sources: cli.EnvVars("GUPPI_PORT"),
			Value:   7654,
		},
		&cli.IntFlag{
			Name:    "discovery-interval",
			Usage:   "Session discovery interval in seconds",
			Sources: cli.EnvVars("GUPPI_DISCOVERY_INTERVAL"),
			Value:   2,
		},
		&cli.BoolFlag{
			Name:    "no-control-mode",
			Usage:   "Disable tmux control mode (use polling only)",
			Sources: cli.EnvVars("GUPPI_NO_CONTROL_MODE"),
		},
		&cli.StringFlag{
			Name:    "socket",
			Usage:   "Unix socket path for local notify CLI (auto-detected if omitted)",
			Sources: cli.EnvVars("GUPPI_SOCKET"),
		},
		&cli.BoolFlag{
			Name:    "no-auth",
			Usage:   "Disable authentication (not recommended for remote access)",
			Sources: cli.EnvVars("GUPPI_NO_AUTH"),
		},
		&cli.BoolFlag{
			Name:    "no-tls",
			Usage:   "Disable TLS (serve plain HTTP)",
			Sources: cli.EnvVars("GUPPI_NO_TLS"),
		},
		&cli.StringFlag{
			Name:    "tls-cert",
			Usage:   "Path to TLS certificate file (auto-generated if omitted)",
			Sources: cli.EnvVars("GUPPI_TLS_CERT"),
		},
		&cli.StringFlag{
			Name:    "tls-key",
			Usage:   "Path to TLS private key file (auto-generated if omitted)",
			Sources: cli.EnvVars("GUPPI_TLS_KEY"),
		},
		&cli.StringSliceFlag{
			Name:    "tls-san",
			Usage:   "Additional TLS SANs for the auto-generated certificate (IPs or hostnames)",
			Sources: cli.EnvVars("GUPPI_TLS_SAN"),
		},
		&cli.StringFlag{
			Name:    "hub",
			Usage:   "Hub address to connect to as a peer (e.g. https://desktop.ts.net:7654)",
			Sources: cli.EnvVars("GUPPI_HUB"),
		},
		&cli.BoolFlag{
			Name:    "local-only",
			Usage:   "Only show local sessions in the web UI (still shares state with hub)",
			Sources: cli.EnvVars("GUPPI_LOCAL_ONLY"),
		},
		&cli.BoolFlag{
			Name:    "insecure",
			Usage:   "Skip TLS certificate verification when connecting to hub",
			Sources: cli.EnvVars("GUPPI_INSECURE"),
		},
		&cli.DurationFlag{
			Name:    "tls-reload-interval",
			Usage:   "Interval between TLS cert file change checks",
			Sources: cli.EnvVars("GUPPI_TLS_RELOAD_INTERVAL"),
			Value:   60 * time.Second,
		},
	}

	cmd := &cli.Command{
		Name:        "server",
		Usage:       "start the guppi web server",
		Description: "starts the web dashboard for monitoring and interacting with tmux sessions",
		Flags:       flags,
		Action:      Execute,
		Before: func(ctx context.Context, c *cli.Command) (context.Context, error) {
			logrus.Info("checking for tmux...")
			_, err := tmux.NewClient()
			if err != nil {
				return ctx, err
			}
			logrus.Info("tmux found")
			return ctx, nil
		},
	}

	common.RegisterCommand(cmd)
}
