package state

import (
	"sync"

	"github.com/sirupsen/logrus"

	"github.com/ekristen/guppi/pkg/projects"
	"github.com/ekristen/guppi/pkg/tmux"
)

// Manager holds the central state tree
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*tmux.Session
	client   *tmux.Client

	// Subscribers for state changes
	subMu       sync.RWMutex
	subscribers []chan StateEvent

	resolver *projects.Resolver
}

// StateEvent represents a change in the state tree
type StateEvent struct {
	Type     string      `json:"type"`
	Session  string      `json:"session,omitempty"`
	Host     string      `json:"host,omitempty"`
	HostName string      `json:"host_name,omitempty"`
	Data     interface{} `json:"data,omitempty"`
}

// NewManager creates a new state manager
func NewManager(client *tmux.Client) *Manager {
	return &Manager{
		sessions: make(map[string]*tmux.Session),
		client:   client,
	}
}

// Subscribe returns a channel that receives state events
func (m *Manager) Subscribe() chan StateEvent {
	ch := make(chan StateEvent, 64)
	m.subMu.Lock()
	m.subscribers = append(m.subscribers, ch)
	m.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel
func (m *Manager) Unsubscribe(ch chan StateEvent) {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	for i, sub := range m.subscribers {
		if sub == ch {
			m.subscribers = append(m.subscribers[:i], m.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

// SetResolver installs a project resolver used to derive each session's
// Project label from its active pane's path. Pass nil to disable project
// derivation (the existing behavior).
func (m *Manager) SetResolver(r *projects.Resolver) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resolver = r
}

// broadcast sends an event to all subscribers
func (m *Manager) broadcast(evt StateEvent) {
	m.subMu.RLock()
	defer m.subMu.RUnlock()
	for _, ch := range m.subscribers {
		select {
		case ch <- evt:
		default:
			// subscriber too slow, drop event
		}
	}
}

// UpdateSessions takes a snapshot of sessions from discovery, diffs against
// previous state, and broadcasts changes
func (m *Manager) UpdateSessions(sessions []*tmux.Session) {
	// Load full details for each session
	for _, session := range sessions {
		if err := m.loadSessionDetails(session); err != nil {
			logrus.WithError(err).WithField("session", session.Name).Warn("failed to load session details")
		}
		m.deriveProject(session)
	}

	m.mu.Lock()
	// Build new map
	newMap := make(map[string]*tmux.Session, len(sessions))
	for _, s := range sessions {
		newMap[s.Name] = s
	}

	// Detect removed sessions
	for name := range m.sessions {
		if _, ok := newMap[name]; !ok {
			m.mu.Unlock()
			m.broadcast(StateEvent{Type: "session-removed", Session: name})
			m.mu.Lock()
		}
	}

	// Detect added sessions
	for name := range newMap {
		if _, ok := m.sessions[name]; !ok {
			m.mu.Unlock()
			m.broadcast(StateEvent{Type: "session-added", Session: name})
			m.mu.Lock()
		}
	}

	m.sessions = newMap
	m.mu.Unlock()

	// Broadcast a general refresh event
	m.broadcast(StateEvent{Type: "sessions-changed"})
}

// loadSessionDetails fills in windows and panes for a session
func (m *Manager) loadSessionDetails(session *tmux.Session) error {
	windows, err := m.client.ListWindows(session.Name)
	if err != nil {
		return err
	}

	for _, win := range windows {
		panes, err := m.client.ListPanes(win.ID)
		if err != nil {
			logrus.WithError(err).WithField("window", win.Name).Warn("failed to list panes")
			continue
		}
		win.Panes = panes
	}

	session.Windows = windows
	return nil
}

// SessionForPane returns the session name for a given pane ID (e.g. "%42").
// Returns empty string if not found.
func (m *Manager) SessionForPane(paneID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, sess := range m.sessions {
		for _, win := range sess.Windows {
			for _, pane := range win.Panes {
				if pane.ID == paneID {
					return sess.Name
				}
			}
		}
	}
	return ""
}

// GetSessions returns all tracked sessions with full details
func (m *Manager) GetSessions() []*tmux.Session {
	// Always refresh from tmux for accuracy
	sessions, err := m.client.ListSessions()
	if err != nil {
		logrus.WithError(err).Warn("failed to list sessions")
		m.mu.RLock()
		defer m.mu.RUnlock()
		result := make([]*tmux.Session, 0, len(m.sessions))
		for _, s := range m.sessions {
			result = append(result, s)
		}
		return result
	}

	// Filter out the control mode session
	filtered := make([]*tmux.Session, 0, len(sessions))
	for _, s := range sessions {
		if s.Name != tmux.ControlSessionName() {
			filtered = append(filtered, s)
		}
	}
	sessions = filtered

	for _, session := range sessions {
		if err := m.loadSessionDetails(session); err != nil {
			logrus.WithError(err).WithField("session", session.Name).Warn("failed to load session details")
		}
		m.deriveProject(session)
	}

	m.mu.Lock()
	m.sessions = make(map[string]*tmux.Session, len(sessions))
	for _, s := range sessions {
		m.sessions[s.Name] = s
	}
	m.mu.Unlock()

	return sessions
}

// deriveProject populates session.Project from the first active pane's
// CurrentPath (or the first pane with a non-empty path if no active pane
// has one). Resolver may be nil — in that case Project is left as-is.
func (m *Manager) deriveProject(session *tmux.Session) {
	m.mu.Lock()
	resolver := m.resolver
	m.mu.Unlock()
	if resolver == nil {
		return
	}
	// Walk windows/panes looking for active-first path.
	var fallback string
	for _, w := range session.Windows {
		for _, p := range w.Panes {
			if p.CurrentPath == "" {
				continue
			}
			if p.Active {
				session.Project = resolver.Resolve(p.CurrentPath)
				return
			}
			if fallback == "" {
				fallback = p.CurrentPath
			}
		}
	}
	if fallback != "" {
		session.Project = resolver.Resolve(fallback)
	}
}
