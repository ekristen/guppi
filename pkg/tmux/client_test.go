package tmux

import "testing"

// TestParsePanesOutputCurrentPath verifies that parsePanesOutput extracts
// pane_current_path (the 10th field of list-panes -F) into Pane.CurrentPath.
func TestParsePanesOutputCurrentPath(t *testing.T) {
	// Two panes with distinct paths
	out := "%0:@1:0:0:1:80:24:zsh:12345:/home/kiran/repos/guppi\n" +
		"%1:@1:0:1:0:80:24:vim:12346:/home/kiran/repos/azureinfrastructureprod"

	panes := parsePanesOutput(out, 10)
	if len(panes) != 2 {
		t.Fatalf("expected 2 panes, got %d", len(panes))
	}
	if p := panes[0]; p.CurrentPath != "/home/kiran/repos/guppi" {
		t.Errorf("pane 0 path: got %q, want /home/kiran/repos/guppi", p.CurrentPath)
	}
	if p := panes[1]; p.CurrentPath != "/home/kiran/repos/azureinfrastructureprod" {
		t.Errorf("pane 1 path: got %q, want /home/kiran/repos/azureinfrastructureprod", p.CurrentPath)
	}
}

// TestParsePanesOutputCurrentPathEmpty verifies that an empty pane_current_path
// (which tmux emits as a trailing colon) leaves CurrentPath empty rather than
// blowing up the parser.
func TestParsePanesOutputCurrentPathEmpty(t *testing.T) {
	out := "%0:@1:0:0:1:80:24:zsh:12345:"

	panes := parsePanesOutput(out, 10)
	if len(panes) != 1 {
		t.Fatalf("expected 1 pane, got %d", len(panes))
	}
	if panes[0].CurrentPath != "" {
		t.Errorf("pane 0 path: got %q, want empty", panes[0].CurrentPath)
	}
	if panes[0].CurrentCommand != "zsh" {
		t.Errorf("pane 0 command: got %q, want zsh", panes[0].CurrentCommand)
	}
}

// TestParsePanesOutputFieldOrderGuard verifies non-path fields still parse
// correctly after paths were added (regression guard against column drift).
func TestParsePanesOutputFieldOrderGuard(t *testing.T) {
	out := "%9:@3:$4:2:0:200:50:nvim:99999:/tmp"
	p := parsePanesOutput(out, 10)[0]
	if p.ID != "%9" {
		t.Errorf("ID: got %q", p.ID)
	}
	if p.WindowID != "@3" {
		t.Errorf("WindowID: got %q", p.WindowID)
	}
	if p.Index != 2 {
		t.Errorf("Index: got %d", p.Index)
	}
	if p.Active {
		t.Errorf("Active: got true, want false")
	}
	if p.Width != 200 || p.Height != 50 {
		t.Errorf("size: got %dx%d, want 200x50", p.Width, p.Height)
	}
	if p.CurrentCommand != "nvim" {
		t.Errorf("CurrentCommand: got %q", p.CurrentCommand)
	}
	if p.PID != 99999 {
		t.Errorf("PID: got %d", p.PID)
	}
	if p.CurrentPath != "/tmp" {
		t.Errorf("CurrentPath: got %q", p.CurrentPath)
	}
}
