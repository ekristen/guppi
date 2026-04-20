package peer

import (
	"net/url"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"

	"github.com/ekristen/guppi/pkg/activity"
	"github.com/ekristen/guppi/pkg/tmux"
)

// PTYManager manages local PTY sessions spawned on behalf of remote browsers
type PTYManager struct {
	mu       sync.RWMutex
	sessions map[string]*ActivePTY
	tmuxPath string
	activity *activity.Tracker
	client   *Client
}

// ActivePTY is a local PTY session being relayed to a remote browser via the hub
type ActivePTY struct {
	StreamID string
	PTY      *tmux.PTYSession
	HubWS    *websocket.Conn
}

// NewPTYManager creates a new PTY manager
func NewPTYManager(tmuxPath string, actTracker *activity.Tracker, client *Client) *PTYManager {
	return &PTYManager{
		sessions: make(map[string]*ActivePTY),
		tmuxPath: tmuxPath,
		activity: actTracker,
		client:   client,
	}
}

// Open spawns a local PTY and connects it to the hub via a dedicated WebSocket
func (pm *PTYManager) Open(req PTYOpenPayload) {
	log := logrus.WithFields(logrus.Fields{
		"stream":  req.StreamID,
		"session": req.Session,
	})

	// Spawn local PTY
	ptySess, err := tmux.NewPTYSession(pm.tmuxPath, req.Session, req.Cols, req.Rows)
	if err != nil {
		log.WithError(err).Error("failed to spawn PTY")
		return
	}

	// Connect PTY WebSocket to hub
	hubWS, err := pm.connectPTYWebSocket(req.StreamID)
	if err != nil {
		log.WithError(err).Error("failed to connect PTY WebSocket to hub")
		ptySess.Close()
		return
	}

	active := &ActivePTY{
		StreamID: req.StreamID,
		PTY:      ptySess,
		HubWS:    hubWS,
	}

	pm.mu.Lock()
	pm.sessions[req.StreamID] = active
	pm.mu.Unlock()

	log.Info("PTY relay started")

	// Run bidirectional relay
	done := make(chan struct{}, 2)

	// PTY → Hub WebSocket (terminal output)
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 32*1024)
		for {
			n, err := ptySess.Read(buf)
			if err != nil {
				return
			}
			if pm.activity != nil {
				pm.activity.Record(req.Session, n)
			}
			if err := hubWS.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	// Hub WebSocket → PTY (keyboard input + resize)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := hubWS.ReadMessage()
			if err != nil {
				return
			}
			switch msgType {
			case websocket.BinaryMessage:
				if _, err := ptySess.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				if err := tmux.HandlePTYControlMessage(ptySess, data); err != nil {
					log.WithError(err).Debug("control message failed")
				}
			}
		}
	}()

	// Wait for either side
	<-done

	pm.cleanup(req.StreamID)
	<-done

	log.Info("PTY relay stopped")
}

// Close closes a PTY session by stream ID
func (pm *PTYManager) Close(streamID string) {
	pm.cleanup(streamID)
}

// Resize resizes a PTY session
func (pm *PTYManager) Resize(streamID string, cols, rows uint16) {
	pm.mu.RLock()
	active, ok := pm.sessions[streamID]
	pm.mu.RUnlock()

	if ok {
		if err := active.PTY.Resize(cols, rows); err != nil {
			logrus.WithField("stream", streamID).WithError(err).Debug("resize failed")
		}
	}
}

func (pm *PTYManager) cleanup(streamID string) {
	pm.mu.Lock()
	active, ok := pm.sessions[streamID]
	if ok {
		delete(pm.sessions, streamID)
	}
	pm.mu.Unlock()

	if ok {
		active.PTY.Close()
		active.HubWS.Close()
	}
}

func (pm *PTYManager) connectPTYWebSocket(streamID string) (*websocket.Conn, error) {
	hubAddr := pm.client.HubURL()
	if !hasScheme(hubAddr) {
		hubAddr = "wss://" + hubAddr
	}
	u, err := url.Parse(hubAddr)
	if err != nil {
		return nil, err
	}

	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else if u.Scheme == "http" {
		u.Scheme = "ws"
	}
	u.Path = "/ws/peer-pty"
	q := u.Query()
	q.Set("stream", streamID)
	u.RawQuery = q.Encode()

	dialer := websocket.DefaultDialer
	if tlsCfg := pm.client.TLSConfig(); tlsCfg != nil {
		dialer = &websocket.Dialer{
			TLSClientConfig: tlsCfg,
		}
	}

	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		return nil, err
	}

	return conn, nil
}
