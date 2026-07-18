package toolevents

import (
	"testing"
	"time"
)

// TestRecordCompletedRetainsAndExpires verifies that a completed event is kept
// in the events map (not deleted) with a future ExpiresAt and Seen=false.
func TestRecordCompletedRetainsAndExpires(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Session: "s1", Window: 0})

	events := tr.GetAll()
	if len(events) != 1 {
		t.Fatalf("expected 1 retained event, got %d", len(events))
	}
	if events[0].Seen {
		t.Error("expected Seen=false on freshly recorded completed event")
	}
	if events[0].ExpiresAt.IsZero() {
		t.Error("expected non-zero ExpiresAt")
	}
	if !events[0].ExpiresAt.After(time.Now()) {
		t.Errorf("ExpiresAt should be in the future, got %v", events[0].ExpiresAt)
	}
}

// TestRecordActiveReplacesCompleted verifies that recording active for the
// same key clears the previously retained completed event.
func TestRecordActiveReplacesCompleted(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Session: "s1", Window: 0})
	tr.Record(&Event{Tool: ToolClaude, Status: StatusActive, Session: "s1", Window: 0})

	haveCompleted := false
	for _, evt := range tr.GetAll() {
		if evt.Status == StatusCompleted && evt.Session == "s1" {
			haveCompleted = true
		}
	}
	if haveCompleted {
		t.Error("active event should clear the previously retained completed event")
	}
}

// TestRecordWaitingReplacesCompleted verifies waiting supersedes completed
// for the same key.
func TestRecordWaitingReplacesCompleted(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolCodex, Status: StatusCompleted, Session: "s1", Window: 0})
	tr.Record(&Event{Tool: ToolCodex, Status: StatusWaiting, Session: "s1", Window: 0, Message: "needs approval"})

	got := tr.GetAll()
	if len(got) != 1 {
		t.Fatalf("expected 1 event after waiting supersedes completed, got %d", len(got))
	}
	if got[0].Status != StatusWaiting {
		t.Errorf("expected Waiting stored, got %v", got[0].Status)
	}
}

// TestMarkSeenFlipsSeenFlag verifies MarkSeen only touches completed events
// for the given host/session.
func TestMarkSeenFlipsSeenFlag(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Session: "s1"})
	tr.Record(&Event{Tool: ToolClaude, Status: StatusWaiting, Session: "s2"})

	tr.MarkSeen("", "s1")

	for _, evt := range tr.GetAll() {
		if evt.Session == "s1" && evt.Status == StatusCompleted && !evt.Seen {
			t.Error("expected Seen=true after MarkSeen for completed event on s1")
		}
		if evt.Session == "s2" && evt.Seen {
			t.Error("MarkSeen should not touch s2 (different session)")
		}
	}
}

// TestReapExpiredRemovesExpiredCompleted verifies the reaper drops completed
// events whose ExpiresAt has passed.
func TestReapExpiredRemovesExpiredCompleted(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Session: "old"})
	tr.mu.Lock()
	if e, ok := tr.events[PaneKey{Session: "old"}]; ok {
		e.ExpiresAt = time.Now().Add(-time.Second)
	}
	tr.mu.Unlock()

	tr.reapExpired()

	if remaining := tr.GetAll(); len(remaining) != 0 {
		t.Errorf("expected zero events after reap, got %d", len(remaining))
	}
}

// TestReapExpiredKeepsUnexpired ensures recent completions survive reaping.
func TestReapExpiredKeepsUnexpired(t *testing.T) {
	tr := NewTracker()
	tr.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Session: "fresh"})
	tr.reapExpired()
	if remaining := tr.GetAll(); len(remaining) != 1 {
		t.Errorf("expected unexpired completed to survive reap, got %d", len(remaining))
	}
}
