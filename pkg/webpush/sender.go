package webpush

import (
	"context"
	"encoding/json"
	"fmt"

	wp "github.com/SherClockHolmes/webpush-go"
	"github.com/sirupsen/logrus"

	"github.com/ekristen/guppi/pkg/toolevents"
)

// PushPayload is the JSON sent to the service worker
type PushPayload struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Session string `json:"session"`
	Window  int    `json:"window,omitempty"`
	Tool    string `json:"tool"`
	Status  string `json:"status"`
}

// Sender listens for tool events and sends push notifications
type Sender struct {
	keys    *VAPIDKeys
	store   *Store
	tracker *toolevents.Tracker
	logger  *logrus.Entry
}

// NewSender creates a push notification sender
func NewSender(keys *VAPIDKeys, store *Store, tracker *toolevents.Tracker) *Sender {
	return &Sender{
		keys:    keys,
		store:   store,
		tracker: tracker,
		logger:  logrus.WithField("component", "webpush"),
	}
}

// Run subscribes to tool events and sends push notifications for waiting/error events
func (s *Sender) Run(ctx context.Context) {
	ch := s.tracker.Subscribe()
	defer s.tracker.Unsubscribe(ch)

	s.logger.Info("push notification sender started")

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			if evt.Status != toolevents.StatusWaiting && evt.Status != toolevents.StatusError {
				continue
			}
			s.sendAll(evt)
		}
	}
}

func (s *Sender) sendAll(evt *toolevents.Event) {
	subs := s.store.All()
	if len(subs) == 0 {
		return
	}

	var title string
	switch evt.Status {
	case toolevents.StatusWaiting:
		title = fmt.Sprintf("%s needs input", evt.Tool)
	case toolevents.StatusError:
		title = fmt.Sprintf("%s error", evt.Tool)
	}

	body := fmt.Sprintf("%s in session \"%s\"", evt.Status, evt.Session)
	if evt.Message != "" {
		body += ": " + evt.Message
	}

	payload := PushPayload{
		Title:   title,
		Body:    body,
		Session: evt.Session,
		Window:  evt.Window,
		Tool:    string(evt.Tool),
		Status:  string(evt.Status),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		s.logger.WithError(err).Error("failed to marshal push payload")
		return
	}

	for _, sub := range subs {
		resp, err := wp.SendNotification(data, sub, &wp.Options{
			Subscriber:      "mailto:guppi@localhost",
			VAPIDPublicKey:  s.keys.PublicKey,
			VAPIDPrivateKey: s.keys.PrivateKey,
			TTL:             86400,
			Urgency:         wp.UrgencyHigh,
		})
		if err != nil {
			s.logger.WithError(err).WithField("endpoint", sub.Endpoint).Warn("push send failed")
			// Remove invalid subscriptions (410 Gone or 404)
			if resp != nil && (resp.StatusCode == 410 || resp.StatusCode == 404) {
				s.store.Remove(sub.Endpoint)
				s.logger.WithField("endpoint", sub.Endpoint).Info("removed expired subscription")
			}
			continue
		}
		if resp.StatusCode >= 400 {
			s.logger.WithField("endpoint", sub.Endpoint).WithField("status", resp.StatusCode).Warn("push endpoint returned error")
			if resp.StatusCode == 410 || resp.StatusCode == 404 {
				s.store.Remove(sub.Endpoint)
			}
		}
		resp.Body.Close()
	}
}
