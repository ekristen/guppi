package toolevents

import (
	"context"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// Tool identifies which AI coding tool sent the event
type Tool string

const (
	ToolClaude  Tool = "claude"
	ToolCodex   Tool = "codex"
	ToolCopilot Tool = "copilot"
	ToolOpenCode Tool = "opencode"
)

// Status represents the current state of an agent
type Status string

const (
	StatusActive    Status = "active"    // agent is running, doing work
	StatusWaiting   Status = "waiting"   // agent needs user attention/approval
	StatusCompleted Status = "completed" // agent finished its task
	StatusError     Status = "error"     // agent encountered an error
)

// Event is a single notification from an agent hook
type Event struct {
	Tool         Tool      `json:"tool"`
	Status       Status    `json:"status"`
	Host         string    `json:"host,omitempty"`          // peer fingerprint (empty = local)
	HostName     string    `json:"host_name,omitempty"`     // peer display name
	Session      string    `json:"session"`                 // tmux session name
	Window       int       `json:"window"`                  // tmux window index
	Pane         string    `json:"pane,omitempty"`          // tmux pane ID (optional)
	Message      string    `json:"message,omitempty"`       // human-readable detail
	Timestamp    time.Time `json:"timestamp"`
	AutoDetected bool      `json:"auto_detected,omitempty"` // true if detected via process tree (not hooks)
	Seen         bool      `json:"seen,omitempty"`          // true once user has viewed the session; applies to completed
	ExpiresAt    time.Time `json:"expires_at,omitempty"`    // when this event should be dropped by the reaper (completed)
}

// PaneKey uniquely identifies a tmux pane
type PaneKey struct {
	Host    string
	Session string
	Window  int
	Pane    string
}

// retentionTTL is how long a completed event stays in the tracker after the
// agent reports completion. The frontend uses this window to surface a
// "DONE — review needed" alert; after it elapses, the reaper drops the event.
const retentionTTL = 5 * time.Minute

// reapInterval controls how often the background reaper sweeps the events
// map for expired completions.
const reapInterval = 30 * time.Second

// nativeWaitingTools is the set of tools that send explicit "waiting" events
// via hooks. Tools not in this set will have inactivity-based and
// silence-based waiting detection as fallbacks.
var nativeWaitingTools = map[Tool]bool{
	ToolClaude:   true,
	ToolOpenCode: true,
}

// Tracker tracks the latest status of AI tools per tmux pane
type Tracker struct {
	mu     sync.RWMutex
	events map[PaneKey]*Event

	// lastActive tracks the most recent "active" event per pane for tools
	// that lack native waiting detection. Used by the inactivity promoter.
	lastActive map[PaneKey]*Event

	// Subscribers
	subMu       sync.RWMutex
	subscribers []chan *Event
}

// NewTracker creates a new tool event tracker
func NewTracker() *Tracker {
	return &Tracker{
		events:     make(map[PaneKey]*Event),
		lastActive: make(map[PaneKey]*Event),
	}
}

// Record stores a new event and broadcasts it to subscribers
func (t *Tracker) Record(evt *Event) {
	evt.Timestamp = time.Now()

	log := logrus.WithFields(logrus.Fields{
		"tool":          evt.Tool,
		"status":        evt.Status,
		"session":       evt.Session,
		"window":        evt.Window,
		"pane":          evt.Pane,
		"host":          evt.Host,
		"message":       evt.Message,
		"auto_detected": evt.AutoDetected,
	})
	log.Debug("recording tool event")

	key := PaneKey{
		Host:    evt.Host,
		Session: evt.Session,
		Window:  evt.Window,
		Pane:    evt.Pane,
	}

	t.mu.Lock()
	switch evt.Status {
	case StatusActive:
		// Active is transient: clear any prior event for this pane (waiting,
		// error, or completed) so the alert UI dismisses. We do not store the
		// active event itself.
		_, existed := t.events[key]
		delete(t.events, key)
		log.WithFields(logrus.Fields{
			"action": "clear", "had_existing": existed, "tracked_count": len(t.events),
		}).Trace("tracker: cleared event (active)")
	case StatusCompleted:
		// Completed is retained with a TTL so the frontend can show a "done
		// but not seen" notification for a short window. A subsequent active
		// or waiting event for the same key will replace it (re-arming).
		evt.Seen = false
		evt.ExpiresAt = time.Now().Add(retentionTTL)
		t.events[key] = evt
		log.WithField("tracked_count", len(t.events)).Trace("tracker: stored completed event (with expiry)")
	default:
		// Waiting / error: store and clear any expiry so a re-recorded waiting
		// event doesn't get reaped mid-attention-span.
		evt.ExpiresAt = time.Time{}
		t.events[key] = evt
		log.WithField("tracked_count", len(t.events)).Trace("tracker: stored event (waiting/error)")
	}

	// Track last activity for tools without native waiting detection.
	// The inactivity promoter uses this to generate synthetic "waiting"
	// events when a tool goes quiet. Auto-detected events are excluded —
	// only hook-based activity should trigger the inactivity timer,
	// since we can't tell if an auto-detected agent is working or idle.
	if !nativeWaitingTools[evt.Tool] && !evt.AutoDetected {
		switch evt.Status {
		case StatusActive:
			t.lastActive[key] = evt
			log.Trace("tracker: added to lastActive for inactivity promotion")
		default:
			// Any explicit waiting/error/completed clears the inactivity tracker
			delete(t.lastActive, key)
			log.Trace("tracker: cleared from lastActive")
		}
	} else if evt.AutoDetected {
		log.Trace("tracker: skipping lastActive (auto-detected)")
	}
	t.mu.Unlock()

	// Broadcast to subscribers
	t.subMu.RLock()
	defer t.subMu.RUnlock()
	sent := 0
	for _, ch := range t.subscribers {
		select {
		case ch <- evt:
			sent++
		default:
			log.Debug("tool event subscriber channel full, dropping")
		}
	}
	log.WithField("subscribers", sent).Trace("tool event broadcast complete")
}

// StaleTimeout is how long an event can sit without an update before being
// considered stale and automatically cleared. This is intentionally long
// because agents like Claude can wait for user input indefinitely.
const StaleTimeout = 24 * time.Hour

// GetAll returns all currently tracked (non-completed) events, pruning stale ones.
func (t *Tracker) GetAll() []*Event {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	events := make([]*Event, 0, len(t.events))
	for key, evt := range t.events {
		if now.Sub(evt.Timestamp) > StaleTimeout {
			delete(t.events, key)
			continue
		}
		events = append(events, evt)
	}
	return events
}

// Clear removes a specific event by session/window/pane
// Clear removes a specific event by host/session/window/pane
func (t *Tracker) Clear(host, session string, window int, pane string) {
	t.mu.Lock()
	key := PaneKey{Host: host, Session: session, Window: window, Pane: pane}
	delete(t.events, key)
	t.mu.Unlock()
}

// ClearAll removes all tracked events
func (t *Tracker) ClearAll() {
	t.mu.Lock()
	t.events = make(map[PaneKey]*Event)
	t.mu.Unlock()
}

// GetForSession returns events for a specific session
func (t *Tracker) GetForSession(session string) []*Event {
	t.mu.RLock()
	defer t.mu.RUnlock()

	var events []*Event
	for key, evt := range t.events {
		if key.Session == session {
			events = append(events, evt)
		}
	}
	return events
}

// Subscribe returns a channel that receives tool events
func (t *Tracker) Subscribe() chan *Event {
	ch := make(chan *Event, 64)
	t.subMu.Lock()
	t.subscribers = append(t.subscribers, ch)
	t.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber
func (t *Tracker) Unsubscribe(ch chan *Event) {
	t.subMu.Lock()
	defer t.subMu.Unlock()
	for i, sub := range t.subscribers {
		if sub == ch {
			t.subscribers = append(t.subscribers[:i], t.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

// StartReaper launches a goroutine that periodically drops expired completed
// events from the tracker so they don't accumulate. Safe to call once after
// NewTracker; multiple calls are allowed but rare.
func (t *Tracker) StartReaper(ctx context.Context) {
	log := logrus.WithField("component", "event-reaper")
	log.WithField("interval", reapInterval).Info("starting completed-event reaper")

	ticker := time.NewTicker(reapInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info("stopping completed-event reaper")
			return
		case <-ticker.C:
			t.reapExpired()
		}
	}
}

// reapExpired removes completed events whose ExpiresAt has elapsed. Called by
// the reaper goroutine and exposed for tests.
func (t *Tracker) reapExpired() {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	removed := 0
	for key, evt := range t.events {
		if evt.Status != StatusCompleted {
			continue
		}
		if !evt.ExpiresAt.IsZero() && now.After(evt.ExpiresAt) {
			delete(t.events, key)
			removed++
		}
	}
	if removed > 0 {
		logrus.WithField("removed", removed).Trace("event-reaper: dropped expired completed events")
	}
}

// MarkSeen flips Seen=true on every completed event for the given
// host/session, so the frontend stops showing the "done but not seen"
// alert. Idempotent. Other statuses (waiting/error) are not touched.
func (t *Tracker) MarkSeen(host, session string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, evt := range t.events {
		if evt.Status != StatusCompleted {
			continue
		}
		if evt.Session != session || evt.Host != host {
			continue
		}
		evt.Seen = true
	}
}

// DefaultInactivityTimeout is how long a non-native-waiting tool can be quiet
// before the tracker promotes it to "waiting". This balances responsiveness
// (catching idle agents quickly) with avoiding false positives during normal
// tool use bursts.
const DefaultInactivityTimeout = 30 * time.Second

// RunInactivityPromoter starts a background goroutine that checks for tools
// without native waiting support that have gone quiet. If a tool's last
// "active" event is older than the timeout, a synthetic "waiting" event is
// recorded. This only affects tools NOT in nativeWaitingTools (e.g. copilot,
// codex, opencode) and never interferes with Claude's explicit waiting hooks.
func (t *Tracker) RunInactivityPromoter(ctx context.Context, timeout time.Duration) {
	log := logrus.WithField("component", "inactivity-promoter")
	log.WithField("timeout", timeout).Info("starting inactivity promoter")

	// Check at half the timeout interval for responsiveness
	interval := timeout / 2
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info("stopping inactivity promoter")
			return
		case <-ticker.C:
			t.promoteInactive(timeout, log)
		}
	}
}

// promoteInactive checks lastActive entries and promotes stale ones to waiting.
func (t *Tracker) promoteInactive(timeout time.Duration, log *logrus.Entry) {
	now := time.Now()

	t.mu.Lock()
	var toPromote []*Event
	for key, evt := range t.lastActive {
		if now.Sub(evt.Timestamp) > timeout {
			toPromote = append(toPromote, evt)
			delete(t.lastActive, key)
		}
	}
	t.mu.Unlock()

	for _, evt := range toPromote {
		log.WithFields(logrus.Fields{
			"tool":    evt.Tool,
			"session": evt.Session,
			"window":  evt.Window,
			"pane":    evt.Pane,
		}).Debug("promoting inactive tool to waiting")

		t.Record(&Event{
			Tool:    evt.Tool,
			Status:  StatusWaiting,
			Host:    evt.Host,
			Session: evt.Session,
			Window:  evt.Window,
			Pane:    evt.Pane,
			Message: "May need attention",
		})
	}
}
