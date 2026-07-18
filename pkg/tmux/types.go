package tmux

import "time"

// Session represents a tmux session
type Session struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Host         string    `json:"host,omitempty"`         // peer fingerprint (empty = local)
	HostName     string    `json:"host_name,omitempty"`    // peer display name
	HostOnline   bool      `json:"host_online,omitempty"`  // whether the host peer is connected
	Windows      []*Window `json:"windows"`
	Created      time.Time `json:"created"`
	Attached     bool      `json:"attached"`
	LastActivity time.Time `json:"last_activity"`
	Project      string    `json:"project,omitempty"`      // derived from active pane path; empty if unknown
}

// Window represents a tmux window
type Window struct {
	ID        string  `json:"id"`
	SessionID string  `json:"session_id"`
	Name      string  `json:"name"`
	Index     int     `json:"index"`
	Active    bool    `json:"active"`
	Layout    string  `json:"layout"`
	Panes     []*Pane `json:"panes"`
}

// PaneDetailed contains resolved session name and window index for a pane,
// avoiding extra tmux queries. Used by the agent detector.
type PaneDetailed struct {
	ID      string `json:"id"`
	Session string `json:"session"` // session name (not ID)
	Window  int    `json:"window"`  // window index
	PID     int    `json:"pid"`
}

// Pane represents a tmux pane
type Pane struct {
	ID             string `json:"id"`
	WindowID       string `json:"window_id"`
	SessionID      string `json:"session_id"`
	Index          int    `json:"index"`
	Active         bool   `json:"active"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	CurrentCommand string `json:"current_command"`
	CurrentPath    string `json:"current_path,omitempty"`
	PID            int    `json:"pid"`
}
