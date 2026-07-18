package tmux

import (
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Client wraps tmux CLI commands
type Client struct {
	tmuxPath string
}

// NewClient creates a new tmux client
func NewClient() (*Client, error) {
	path, err := exec.LookPath("tmux")
	if err != nil {
		return nil, fmt.Errorf("tmux not found in PATH: %w", err)
	}
	return &Client{tmuxPath: path}, nil
}

// TmuxPath returns the path to the tmux binary
func (c *Client) TmuxPath() string {
	return c.tmuxPath
}

// Exec runs a tmux command and returns stdout
func (c *Client) Exec(args ...string) (string, error) {
	cmd := exec.Command(c.tmuxPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("tmux %s: %w: %s", strings.Join(args, " "), err, stderr.String())
	}
	return stdout.String(), nil
}

// ListSessions returns all tmux sessions
func (c *Client) ListSessions() ([]*Session, error) {
	out, err := c.Exec("list-sessions", "-F", "#{session_id}:#{session_name}:#{session_created}:#{session_attached}:#{session_activity}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}

	var sessions []*Session
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 5)
		if len(parts) < 5 {
			continue
		}

		created, _ := strconv.ParseInt(parts[2], 10, 64)
		attached := parts[3] != "0"
		activity, _ := strconv.ParseInt(parts[4], 10, 64)

		sessions = append(sessions, &Session{
			ID:           parts[0],
			Name:         parts[1],
			Created:      time.Unix(created, 0),
			Attached:     attached,
			LastActivity: time.Unix(activity, 0),
		})
	}
	return sessions, nil
}

// ListWindows returns windows for a session
func (c *Client) ListWindows(sessionName string) ([]*Window, error) {
	out, err := c.Exec("list-windows", "-t", sessionName, "-F",
		"#{window_id}:#{session_id}:#{window_name}:#{window_index}:#{window_active}:#{window_layout}")
	if err != nil {
		return nil, err
	}

	var windows []*Window
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 6)
		if len(parts) < 6 {
			continue
		}
		idx, _ := strconv.Atoi(parts[3])
		windows = append(windows, &Window{
			ID:        parts[0],
			SessionID: parts[1],
			Name:      parts[2],
			Index:     idx,
			Active:    parts[4] == "1",
			Layout:    parts[5],
		})
	}
	return windows, nil
}

// ListPanes returns panes for a window
func (c *Client) ListPanes(target string) ([]*Pane, error) {
	out, err := c.Exec("list-panes", "-t", target, "-F",
		"#{pane_id}:#{window_id}:#{session_id}:#{pane_index}:#{pane_active}:#{pane_width}:#{pane_height}:#{pane_current_command}:#{pane_pid}:#{pane_current_path}")
	if err != nil {
		return nil, err
	}

	return parsePanesOutput(out, 10), nil
}

// ListAllPanes returns all panes across all sessions
func (c *Client) ListAllPanes() ([]*Pane, error) {
	out, err := c.Exec("list-panes", "-a", "-F",
		"#{pane_id}:#{window_id}:#{session_id}:#{pane_index}:#{pane_active}:#{pane_width}:#{pane_height}:#{pane_current_command}:#{pane_pid}:#{pane_current_path}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}

	return parsePanesOutput(out, 10), nil
}

// parsePanesOutput parses `list-panes` output into Pane structs.
// The format string emits 10 fields per line; current_path (last field) may
// be empty when tmux cannot determine the pane's path.
func parsePanesOutput(out string, expectedFields int) []*Pane {
	var panes []*Pane
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", expectedFields)
		if len(parts) < expectedFields {
			continue
		}
		idx, _ := strconv.Atoi(parts[3])
		w, _ := strconv.Atoi(parts[5])
		h, _ := strconv.Atoi(parts[6])
		pid, _ := strconv.Atoi(parts[8])
		var path string
		if expectedFields >= 10 {
			path = parts[9]
		}
		panes = append(panes, &Pane{
			ID:             parts[0],
			WindowID:       parts[1],
			SessionID:      parts[2],
			Index:          idx,
			Active:         parts[4] == "1",
			Width:          w,
			Height:         h,
			CurrentCommand: parts[7],
			CurrentPath:    path,
			PID:            pid,
		})
	}
	return panes
}

// ListAllPanesDetailed returns all panes with session name and window index
// resolved by tmux (avoids extra ListSessions/ListWindows calls).
func (c *Client) ListAllPanesDetailed() ([]*PaneDetailed, error) {
	out, err := c.Exec("list-panes", "-a", "-F",
		"#{pane_id}:#{session_name}:#{window_index}:#{pane_pid}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}

	var panes []*PaneDetailed
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 4)
		if len(parts) < 4 {
			continue
		}
		winIdx, _ := strconv.Atoi(parts[2])
		pid, _ := strconv.Atoi(parts[3])
		panes = append(panes, &PaneDetailed{
			ID:      parts[0],
			Session: parts[1],
			Window:  winIdx,
			PID:     pid,
		})
	}
	return panes, nil
}

// HasSession checks if a session exists
func (c *Client) HasSession(name string) bool {
	_, err := c.Exec("has-session", "-t", name)
	return err == nil
}

// SelectWindow switches the active window in a session
func (c *Client) SelectWindow(session, index string) error {
	_, err := c.Exec("select-window", "-t", fmt.Sprintf("%s:%s", session, index))
	return err
}

// SelectPane switches the active pane in a session window
func (c *Client) SelectPane(target string) error {
	_, err := c.Exec("select-pane", "-t", target)
	return err
}

// NewSession creates a new tmux session with the given name (detached)
func (c *Client) NewSession(name string) error {
	_, err := c.Exec("new-session", "-d", "-s", name)
	return err
}

// RenameSession renames a tmux session
func (c *Client) RenameSession(oldName, newName string) error {
	_, err := c.Exec("rename-session", "-t", oldName, newName)
	return err
}

// CapturePaneContent returns the visible text content of a pane
func (c *Client) CapturePaneContent(paneID string) (string, error) {
	return c.Exec("capture-pane", "-t", paneID, "-p")
}
