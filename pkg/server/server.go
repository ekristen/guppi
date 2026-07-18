package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"strings"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"

	wp "github.com/SherClockHolmes/webpush-go"

	"github.com/ekristen/guppi/pkg/agentcheck"
	"github.com/ekristen/guppi/pkg/activity"
	"github.com/ekristen/guppi/pkg/auth"
	"github.com/ekristen/guppi/pkg/common"
	"github.com/ekristen/guppi/pkg/identity"
	"github.com/ekristen/guppi/pkg/peer"
	"github.com/ekristen/guppi/pkg/preferences"
	"github.com/ekristen/guppi/pkg/socket"
	"github.com/ekristen/guppi/pkg/state"
	"github.com/ekristen/guppi/pkg/stats"
	"github.com/ekristen/guppi/pkg/tlscert"
	"github.com/ekristen/guppi/pkg/tmux"
	"github.com/ekristen/guppi/pkg/toolevents"
	"github.com/ekristen/guppi/pkg/webpush"
	"github.com/ekristen/guppi/pkg/ws"
)


type Options struct {
	Port            int
	SocketPath      string
	Client          *tmux.Client
	StateMgr        *state.Manager
	Tracker         *toolevents.Tracker
	ActivityTracker *activity.Tracker
	PushKeys        *webpush.VAPIDKeys
	PushStore       *webpush.Store
	PrefStore       *preferences.Store
	AuthEnabled     bool
	PasswordStore   *auth.PasswordStore
	SessionMgr      *auth.SessionManager
	TLSConfig       *tls.Config
	TLSFingerprint  string // hex SHA256 of leaf TLS cert (set automatically)
	CertReloader    *tlscert.CertReloader
	CACertPEM       string // CA certificate PEM for pairing (empty when using external certs)
	PeerMgr         *peer.Manager
	PeerHandler     *peer.Handler
	PairingMgr      *identity.PairingManager
	PTYRelay        *peer.PTYRelay
	Detector        *toolevents.Detector
	LocalOnly       bool
}

// handleRemoteSession handles a terminal session request for a remote peer.
// It tells the peer to spawn a PTY, then bridges the browser WS to the peer's PTY WS.
func handleRemoteSession(w http.ResponseWriter, r *http.Request, opts *Options, hostID string) {
	sessionName := r.URL.Query().Get("name")
	if sessionName == "" {
		http.Error(w, "missing session name", http.StatusBadRequest)
		return
	}

	cols := uint16(80)
	rows := uint16(24)
	if c := r.URL.Query().Get("cols"); c != "" {
		if v, err := strconv.ParseUint(c, 10, 16); err == nil && v > 0 {
			cols = uint16(v)
		}
	}
	if rv := r.URL.Query().Get("rows"); rv != "" {
		if v, err := strconv.ParseUint(rv, 10, 16); err == nil && v > 0 {
			rows = uint16(v)
		}
	}

	// Get the peer connection
	peerConn := opts.PeerMgr.GetPeerConnection(hostID)
	if peerConn == nil {
		http.Error(w, "peer not connected", http.StatusBadGateway)
		return
	}

	// Upgrade browser to WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin:    ws.CheckSameOrigin,
		ReadBufferSize: 1024, WriteBufferSize: 1024 * 16,
	}
	browserWS, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer browserWS.Close()

	// Generate stream ID and register pending relay
	streamID := peer.GenerateStreamID()
	pending := opts.PTYRelay.RegisterPending(streamID, hostID, browserWS)
	defer opts.PTYRelay.Remove(streamID)

	// Tell the peer to open a PTY
	msg, _ := peer.NewMessage(peer.MsgPTYOpen, peer.PTYOpenPayload{
		StreamID: streamID,
		Session:  sessionName,
		Cols:     cols,
		Rows:     rows,
	})
	select {
	case peerConn.Send <- msg:
	default:
		return
	}

	// Wait for the peer to connect its PTY WebSocket
	select {
	case peerWS := <-pending.Ready:
		if peerWS == nil {
			return
		}
		// Bridge the two WebSocket connections
		peer.Bridge(browserWS, peerWS, streamID)
	case <-time.After(15 * time.Second):
		return
	}
}

func Run(ctx context.Context, opts *Options) error {
	logger := logrus.WithField("component", "server")

	tlsEnabled := opts.TLSConfig != nil
	secureCookies := tlsEnabled

	r := chi.NewRouter()
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.StripSlashes)
	r.Use(chimiddleware.RequestID)

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Public auth endpoints (no middleware)
		r.Get("/auth/status", auth.StatusHandler(opts.AuthEnabled, opts.PasswordStore))
		if opts.AuthEnabled {
			r.Post("/auth/setup", auth.SetupHandler(opts.PasswordStore, opts.SessionMgr, secureCookies))
			r.Post("/auth/login", auth.LoginHandler(opts.PasswordStore, opts.SessionMgr, secureCookies))
			r.Post("/auth/logout", auth.LogoutHandler(opts.SessionMgr))
			r.Get("/auth/check", auth.CheckHandler(opts.SessionMgr))
		}

		// TLS status — tells frontend whether CA cert is available for trust
		r.Get("/tls/status", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{
				"ca_available": opts.CACertPEM != "",
			})
		})

		// TLS CA certificate download — public, no auth required
		r.Get("/tls/ca.crt", func(w http.ResponseWriter, r *http.Request) {
			if opts.CACertPEM == "" {
				http.Error(w, "no CA certificate available", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/x-x509-ca-cert")
			w.Header().Set("Content-Disposition", `attachment; filename="guppi-ca.crt"`)
			w.Write([]byte(opts.CACertPEM))
		})

		// Apple mobileconfig profile for CA trust — public, no auth required
		r.Get("/tls/ca.mobileconfig", func(w http.ResponseWriter, r *http.Request) {
			if opts.CACertPEM == "" {
				http.Error(w, "no CA certificate available", http.StatusNotFound)
				return
			}
			profile := buildMobileConfig(opts.CACertPEM)
			w.Header().Set("Content-Type", "application/x-apple-aspen-config")
			w.Header().Set("Content-Disposition", `attachment; filename="guppi-ca.mobileconfig"`)
			w.Write(profile)
		})

		// Version endpoint — public, no auth required
		r.Get("/version", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"version": common.VERSION,
				"commit":  common.COMMIT,
			})
		})

		// Tool event ingest — no auth required (used by local CLI via unix socket)
		r.Post("/tool-event", func(w http.ResponseWriter, r *http.Request) {
			body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
			if err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}

			logrus.WithField("raw_body", string(body)).Trace("tool-event API: received request")

			var evt toolevents.Event
			if err := json.Unmarshal(body, &evt); err != nil {
				logrus.WithError(err).WithField("raw_body", string(body)).Trace("tool-event API: JSON parse failed")
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}

			if evt.Tool == "" || evt.Status == "" || evt.Session == "" {
				logrus.WithFields(logrus.Fields{
					"tool": evt.Tool, "status": evt.Status, "session": evt.Session,
				}).Trace("tool-event API: missing required fields")
				http.Error(w, "tool, status, and session are required", http.StatusBadRequest)
				return
			}

			// Stamp local host identity when running in multi-host mode
			if opts.PeerMgr != nil && evt.Host == "" {
				evt.Host = opts.PeerMgr.LocalID()
				evt.HostName = opts.PeerMgr.LocalName()
			}

			logrus.WithFields(logrus.Fields{
				"tool":    evt.Tool,
				"status":  evt.Status,
				"session": evt.Session,
				"window":  evt.Window,
				"pane":    evt.Pane,
				"message": evt.Message,
				"host":    evt.Host,
			}).Debug("received tool event via API")

			opts.Tracker.Record(&evt)
			w.WriteHeader(http.StatusNoContent)
		})

		// Protected API routes
		r.Group(func(r chi.Router) {
			if opts.AuthEnabled {
				r.Use(auth.Middleware(opts.SessionMgr))
			}

			// Agent status — check which agents are installed/configured
			r.Get("/agent-status", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(agentcheck.CheckAgents())
			})

			r.Get("/sessions", func(w http.ResponseWriter, r *http.Request) {
				var sessions []*tmux.Session
				if opts.PeerMgr != nil && !opts.LocalOnly {
					sessions = opts.PeerMgr.GetAllSessions()
				} else {
					sessions = opts.StateMgr.GetSessions()
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(sessions)
			})

			r.Get("/hosts", func(w http.ResponseWriter, r *http.Request) {
				if opts.PeerMgr != nil {
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(opts.PeerMgr.GetHosts())
				} else {
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode([]interface{}{})
				}
			})

			r.Post("/session/new", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Name string `json:"name"`
					Host string `json:"host,omitempty"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
					http.Error(w, "name is required", http.StatusBadRequest)
					return
				}

				// Remote host — forward via peer connection
				if req.Host != "" && opts.PeerMgr != nil && !opts.PeerMgr.IsLocal(req.Host) {
					peerConn := opts.PeerMgr.GetPeerConnection(req.Host)
					if peerConn == nil {
						http.Error(w, "peer not connected", http.StatusBadGateway)
						return
					}
					params, _ := json.Marshal(map[string]string{"name": req.Name})
					msg, _ := peer.NewMessage(peer.MsgSessionAction, peer.SessionActionPayload{
						Action: "new",
						Params: params,
					})
					select {
					case peerConn.Send <- msg:
						w.WriteHeader(http.StatusNoContent)
					default:
						http.Error(w, "peer send queue full", http.StatusBadGateway)
					}
					return
				}

				if err := opts.Client.NewSession(req.Name); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				// Trigger state refresh so WebSocket clients get notified
				if fresh, err := opts.Client.ListSessions(); err == nil {
					opts.StateMgr.UpdateSessions(fresh)
				}
				w.WriteHeader(http.StatusNoContent)
			})

			r.Post("/session/rename", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					OldName string `json:"old_name"`
					NewName string `json:"new_name"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OldName == "" || req.NewName == "" {
					http.Error(w, "old_name and new_name are required", http.StatusBadRequest)
					return
				}
				if err := opts.Client.RenameSession(req.OldName, req.NewName); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if fresh, err := opts.Client.ListSessions(); err == nil {
					opts.StateMgr.UpdateSessions(fresh)
				}
				w.WriteHeader(http.StatusNoContent)
			})

			r.Post("/session/select-window", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Session string `json:"session"`
					Window  int    `json:"window"`
					Host    string `json:"host,omitempty"`
					Pane    string `json:"pane,omitempty"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Session == "" {
					http.Error(w, "session and window are required", http.StatusBadRequest)
					return
				}

				// Remote host — forward via peer connection
				if req.Host != "" && opts.PeerMgr != nil && !opts.PeerMgr.IsLocal(req.Host) {
					peerConn := opts.PeerMgr.GetPeerConnection(req.Host)
					if peerConn == nil {
						http.Error(w, "peer not connected", http.StatusBadGateway)
						return
					}
					params, _ := json.Marshal(map[string]interface{}{
						"session": req.Session,
						"window":  req.Window,
						"pane":    req.Pane,
					})
					msg, _ := peer.NewMessage(peer.MsgSessionAction, peer.SessionActionPayload{
						Action: "select-window",
						Params: params,
					})
					select {
					case peerConn.Send <- msg:
						w.WriteHeader(http.StatusNoContent)
					default:
						http.Error(w, "peer send queue full", http.StatusBadGateway)
					}
					return
				}

				index := fmt.Sprintf("%d", req.Window)
				if err := opts.Client.SelectWindow(req.Session, index); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if req.Pane != "" {
					if err := opts.Client.SelectPane(req.Pane); err != nil {
						logrus.WithError(err).Warn("failed to select pane")
					}
				}
				w.WriteHeader(http.StatusNoContent)
			})

			// Tool event query/management (auth-protected)
			r.Get("/tool-events", func(w http.ResponseWriter, r *http.Request) {
				session := r.URL.Query().Get("session")
				var events []*toolevents.Event
				if session != "" {
					events = opts.Tracker.GetForSession(session)
				} else {
					events = opts.Tracker.GetAll()
				}

				// Merge in auto-detected agents that don't have a tracked event.
				// These are "active" agents found via process-tree inspection
				// (e.g. codex/copilot running as node).
				if opts.Detector != nil {
					tracked := make(map[string]bool)
					for _, evt := range events {
						if evt.Pane != "" {
							tracked[evt.Pane] = true
						}
					}
					for paneID, tool := range opts.Detector.DetectedPanes() {
						if tracked[paneID] {
							continue
						}
						info := opts.Detector.PaneInfo(paneID)
						if session != "" && info.Session != session {
							continue
						}
						evt := &toolevents.Event{
							Tool:         tool,
							Status:       toolevents.StatusActive,
							Session:      info.Session,
							Window:       info.Window,
							Pane:         paneID,
							Message:      "auto-detected",
							AutoDetected: true,
						}
						// Stamp local host identity so frontend session key matching works
						if opts.PeerMgr != nil {
							evt.Host = opts.PeerMgr.LocalID()
							evt.HostName = opts.PeerMgr.LocalName()
						}
						events = append(events, evt)
					}
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(events)
			})

			r.Delete("/tool-events", func(w http.ResponseWriter, r *http.Request) {
				opts.Tracker.ClearAll()
				w.WriteHeader(http.StatusNoContent)
			})

			r.Delete("/tool-event", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Host    string `json:"host"`
					Session string `json:"session"`
					Window  int    `json:"window"`
					Pane    string `json:"pane"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Session == "" {
					http.Error(w, "session is required", http.StatusBadRequest)
					return
				}
				opts.Tracker.Clear(req.Host, req.Session, req.Window, req.Pane)
				w.WriteHeader(http.StatusNoContent)
			})

			// Mark all completed events for a session as seen.
			// Called by the frontend when the user has the session open long
			// enough to have noticed the "DONE" pill (≥2s dwell).
			r.Post("/tool-events/seen", func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					Host    string `json:"host"`
					Session string `json:"session"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Session == "" {
					http.Error(w, "session is required", http.StatusBadRequest)
					return
				}
				opts.Tracker.MarkSeen(req.Host, req.Session)
				w.WriteHeader(http.StatusNoContent)
			})

			// Stats endpoint — aggregate overview data
			r.Get("/stats", func(w http.ResponseWriter, r *http.Request) {
				sessions := opts.StateMgr.GetSessions()
				allPanes, _ := opts.Client.ListAllPanes()

				agentCommands := map[string]bool{
					"claude": true, "codex": true, "copilot": true, "opencode": true,
				}
				totalWindows := 0
				attachedSessions := 0
				agentPanes := 0
				for _, s := range sessions {
					if s.Attached {
						attachedSessions++
					}
					totalWindows += len(s.Windows)
				}

				// Build a set of panes with known agent tool events (from hooks
				// or process-tree detection). This catches agents like codex and
				// copilot that show up as "node" in pane_current_command.
				toolEvents := opts.Tracker.GetAll()
				agentEventPanes := make(map[string]bool)
				for _, evt := range toolEvents {
					if evt.Pane != "" {
						agentEventPanes[evt.Pane] = true
					}
				}
				// Also include panes detected via process tree inspection
				if opts.Detector != nil {
					for paneID := range opts.Detector.DetectedPanes() {
						agentEventPanes[paneID] = true
					}
				}

				for _, p := range allPanes {
					if agentCommands[p.CurrentCommand] || agentEventPanes[p.ID] {
						agentPanes++
					}
				}
				waitingAgents := 0
				errorAgents := 0
				for _, evt := range toolEvents {
					switch evt.Status {
					case "waiting":
						waitingAgents++
					case "error":
						errorAgents++
					}
				}

				result := map[string]interface{}{
					"sessions": map[string]int{
						"total":    len(sessions),
						"attached": attachedSessions,
						"detached": len(sessions) - attachedSessions,
					},
					"windows":     totalWindows,
					"panes":       len(allPanes),
					"agent_panes": agentPanes,
					"agents": map[string]int{
						"active":  agentPanes,
						"waiting": waitingAgents,
						"error":   errorAgents,
					},
					"processes": stats.ProcessCountsFromSessions(sessions),
					"system":    stats.SystemStats(),
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			})

			// Activity endpoints
			r.Get("/activity", func(w http.ResponseWriter, r *http.Request) {
				session := r.URL.Query().Get("session")
				w.Header().Set("Content-Type", "application/json")
				if session != "" {
					snap := opts.ActivityTracker.Get(session)
					// Stamp host on local snapshot in multi-host mode
					if snap != nil && opts.PeerMgr != nil && snap.Host == "" {
						snap.Host = opts.PeerMgr.LocalID()
					}
					json.NewEncoder(w).Encode(snap)
				} else {
					snapshots := opts.ActivityTracker.GetAll()
					// Stamp host on local snapshots in multi-host mode
					if opts.PeerMgr != nil {
						localID := opts.PeerMgr.LocalID()
						for _, s := range snapshots {
							if s.Host == "" {
								s.Host = localID
							}
						}
						// Merge in peer activity if not local-only
						if !opts.LocalOnly {
							peerActivity := opts.PeerMgr.GetAllActivity()
							snapshots = append(snapshots, peerActivity...)
						}
					}
					json.NewEncoder(w).Encode(snapshots)
				}
			})

			// Push notification endpoints
			r.Get("/push/vapid-key", func(w http.ResponseWriter, r *http.Request) {
				if opts.PushKeys == nil {
					http.Error(w, "push notifications not configured", http.StatusServiceUnavailable)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{
					"public_key": opts.PushKeys.PublicKey,
				})
			})

			r.Post("/push/subscribe", func(w http.ResponseWriter, r *http.Request) {
				if opts.PushStore == nil {
					http.Error(w, "push notifications not configured", http.StatusServiceUnavailable)
					return
				}
				var sub wp.Subscription
				if err := json.NewDecoder(r.Body).Decode(&sub); err != nil || sub.Endpoint == "" {
					http.Error(w, "invalid subscription", http.StatusBadRequest)
					return
				}
				opts.PushStore.Add(&sub)
				w.WriteHeader(http.StatusNoContent)
			})

			r.Post("/push/unsubscribe", func(w http.ResponseWriter, r *http.Request) {
				if opts.PushStore == nil {
					http.Error(w, "push notifications not configured", http.StatusServiceUnavailable)
					return
				}
				var req struct {
					Endpoint string `json:"endpoint"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Endpoint == "" {
					http.Error(w, "endpoint is required", http.StatusBadRequest)
					return
				}
				opts.PushStore.Remove(req.Endpoint)
				w.WriteHeader(http.StatusNoContent)
			})

			// Preferences endpoints
			r.Get("/preferences", func(w http.ResponseWriter, r *http.Request) {
				var prefs *preferences.Preferences
				if opts.PrefStore != nil {
					prefs = opts.PrefStore.Get()
				} else {
					prefs = preferences.Default()
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(prefs)
			})

			r.Put("/preferences", func(w http.ResponseWriter, r *http.Request) {
				if opts.PrefStore == nil {
					http.Error(w, "preferences not available", http.StatusServiceUnavailable)
					return
				}
				var prefs preferences.Preferences
				if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
					http.Error(w, "invalid JSON", http.StatusBadRequest)
					return
				}
				if err := opts.PrefStore.Update(&prefs); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(&prefs)
			})

			// Pairing code generation (for the hub to generate codes)
			r.Post("/pair", func(w http.ResponseWriter, r *http.Request) {
				if opts.PairingMgr == nil {
					http.Error(w, "pairing not available", http.StatusServiceUnavailable)
					return
				}
				code, err := opts.PairingMgr.Generate()
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				// Append TLS fingerprint to code so peers can verify the cert
				displayCode := code.Code
				fp := opts.TLSFingerprint
				if opts.CertReloader != nil {
					fp = opts.CertReloader.Fingerprint()
				}
				if fp != "" {
					displayCode = code.Code + ":" + fp[:16]
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{
					"code":       displayCode,
					"expires_at": code.ExpiresAt,
				})
			})
		})
	})

	// WebSocket routes (protected by auth if enabled)
	hub := ws.NewHub(opts.StateMgr, opts.Tracker)
	if opts.ActivityTracker != nil {
		var peerActivity ws.ActivitySource
		localHostID := ""
		localOnly := opts.LocalOnly
		if opts.PeerMgr != nil {
			peerActivity = opts.PeerMgr
			localHostID = opts.PeerMgr.LocalID()
		}
		hub.SetActivityTracker(opts.ActivityTracker, peerActivity, localHostID, localOnly)
	}
	go hub.Run()

	ptyHandler := ws.NewPTYTerminalHandler(opts.Client.TmuxPath(), opts.ActivityTracker)

	if opts.AuthEnabled {
		authMw := auth.Middleware(opts.SessionMgr)
		r.With(authMw).Get("/ws/events", hub.HandleEvents)
		r.With(authMw).Get("/ws/session", func(w http.ResponseWriter, req *http.Request) {
			// Route remote sessions through PTY relay
			hostID := req.URL.Query().Get("host")
			if opts.PeerMgr != nil && hostID != "" && !opts.PeerMgr.IsLocal(hostID) {
				handleRemoteSession(w, req, opts, hostID)
				return
			}
			ptyHandler.HandleSession(w, req)
		})
	} else {
		r.Get("/ws/events", hub.HandleEvents)
		r.Get("/ws/session", func(w http.ResponseWriter, req *http.Request) {
			hostID := req.URL.Query().Get("host")
			if opts.PeerMgr != nil && hostID != "" && !opts.PeerMgr.IsLocal(hostID) {
				handleRemoteSession(w, req, opts, hostID)
				return
			}
			ptyHandler.HandleSession(w, req)
		})
	}

	// Peer WebSocket routes (no browser auth — peers use their own challenge-response)
	if opts.PeerHandler != nil {
		r.Get("/ws/peer", opts.PeerHandler.HandlePeer)
		r.Post("/api/pair/complete", opts.PeerHandler.HandlePairing)
	}
	if opts.PTYRelay != nil {
		r.Get("/ws/peer-pty", opts.PTYRelay.HandlePeerPTY)
	}

	// Serve embedded frontend
	sub, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		return fmt.Errorf("frontend fs: %w", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		f, err := sub.Open(r.URL.Path[1:])
		if err != nil {
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})

	srv := &http.Server{
		Handler:           r,
		ErrorLog:          log.New(logger.WriterLevel(logrus.WarnLevel), "", 0),
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		// Note: ReadTimeout and WriteTimeout are intentionally omitted.
		// They apply to the underlying net.Conn and would kill long-lived
		// WebSocket connections after the timeout period.
	}

	serverErr := make(chan error, 2)

	// Start TCP listener for browser connections
	tcpAddr := fmt.Sprintf(":%d", opts.Port)
	tcpListener, err := net.Listen("tcp", tcpAddr)
	if err != nil {
		return fmt.Errorf("tcp listen: %w", err)
	}

	go func() {
		var serveErr error
		if tlsEnabled {
			tlsListener := tls.NewListener(tcpListener, opts.TLSConfig)
			serveErr = srv.Serve(tlsListener)
		} else {
			serveErr = srv.Serve(tcpListener)
		}
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			logger.WithError(serveErr).Error("tcp listen error")
			serverErr <- serveErr
		}
	}()

	scheme := "http"
	if tlsEnabled {
		scheme = "https"
	}
	logger.WithField("port", opts.Port).Info("starting guppi server")
	logger.Infof("open %s://localhost:%d in your browser", scheme, opts.Port)
	if opts.AuthEnabled {
		logger.Info("authentication is enabled")
	}

	// Start Unix socket listener for local notify CLI
	var unixListener net.Listener
	socketPath := opts.SocketPath
	if socketPath == "" {
		socketPath = socket.DefaultPath()
	}
	if err := socket.EnsureDir(socketPath); err != nil {
		logger.WithError(err).Warn("failed to create socket directory, notify via socket will be unavailable")
	} else {
		// Remove stale socket file from a previous run
		_ = socket.Cleanup(socketPath)

		unixListener, err = net.Listen("unix", socketPath)
		if err != nil {
			logger.WithError(err).Warn("failed to listen on unix socket, notify via socket will be unavailable")
		} else {
			go func() {
				if err := srv.Serve(unixListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
					logger.WithError(err).Error("unix socket listen error")
					serverErr <- err
				}
			}()
			logger.WithField("socket", socketPath).Info("listening on unix socket")
		}
	}

	select {
	case <-ctx.Done():
	case err := <-serverErr:
		return fmt.Errorf("server error: %w", err)
	}

	logger.Info("shutting down server")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.WithError(err).Error("unable to shutdown gracefully")
		return err
	}

	// Clean up socket file
	if unixListener != nil {
		_ = socket.Cleanup(socketPath)
	}

	return nil
}

// buildMobileConfig creates an Apple configuration profile that installs the
// guppi CA certificate as a trusted root. Users can tap the resulting
// .mobileconfig file on iOS/macOS to install it.
func buildMobileConfig(caCertPEM string) []byte {
	// Strip PEM headers to get raw base64 payload
	payload := caCertPEM

	const profileTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadCertificateFileName</key>
			<string>guppi-ca.crt</string>
			<key>PayloadContent</key>
			<data>%s</data>
			<key>PayloadDescription</key>
			<string>Adds the guppi CA certificate as a trusted root</string>
			<key>PayloadDisplayName</key>
			<string>guppi CA</string>
			<key>PayloadIdentifier</key>
			<string>com.guppi.ca-cert</string>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadUUID</key>
			<string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDisplayName</key>
	<string>guppi CA Trust</string>
	<key>PayloadIdentifier</key>
	<string>com.guppi.ca-trust-profile</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>F1E2D3C4-B5A6-7890-FEDC-BA0987654321</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
	<key>PayloadDescription</key>
	<string>Installs the guppi CA certificate so your device trusts the guppi server</string>
</dict>
</plist>`

	// The mobileconfig PayloadContent <data> field expects base64-encoded DER.
	// Our PEM is already base64-encoded DER with headers — strip the headers.
	clean := ""
	for _, line := range strings.Split(payload, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "-----") {
			continue
		}
		clean += trimmed
	}

	return []byte(fmt.Sprintf(profileTemplate, clean))
}
