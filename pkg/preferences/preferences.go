package preferences

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Terminal struct {
	FontSize   int    `json:"font_size"`
	FontFamily string `json:"font_family"`
	Scrollback int    `json:"scrollback"`
}

type Sidebar struct {
	DefaultCollapsed bool     `json:"default_collapsed"`
	HiddenSessions   []string `json:"hidden_sessions"`
	CollapseMode     string   `json:"collapse_mode"`
	GroupBy          string   `json:"group_by,omitempty"` // 'host' (default) | 'project' | 'none'
}

type Notifications struct {
	Statuses []string `json:"statuses"`
}

type AgentBanner struct {
	AutoDismissSeconds int `json:"auto_dismiss_seconds"`
}

type Preferences struct {
	Terminal                Terminal          `json:"terminal"`
	Theme                   string            `json:"theme"`
	CustomTheme             map[string]string `json:"custom_theme,omitempty"`
	Sidebar                 Sidebar           `json:"sidebar"`
	DefaultView             string            `json:"default_view"`
	Notifications           Notifications     `json:"notifications"`
	AgentBanner             AgentBanner       `json:"agent_banner"`
	QuickSwitcherShortcut   string            `json:"quick_switcher_shortcut"`
	SparklinesVisible       bool              `json:"sparklines_visible"`
	OverviewRefreshInterval int               `json:"overview_refresh_interval"`
	TimestampFormat         string            `json:"timestamp_format"`
	LockTimeoutMinutes      int               `json:"lock_timeout_minutes"`
	LockBackgroundFaster    bool              `json:"lock_background_faster"`
	LockBackgroundMinutes   int               `json:"lock_background_minutes"`
	FullscreenHideAlerts    bool              `json:"fullscreen_hide_alerts"`
}

func Default() *Preferences {
	return &Preferences{
		Terminal: Terminal{
			FontSize:   13,
			FontFamily: "Space Mono",
			Scrollback: 5000,
		},
		Theme:        "retro-blue",
		CustomTheme:  map[string]string{},
		Sidebar: Sidebar{
			DefaultCollapsed: false,
			HiddenSessions:   []string{},
			CollapseMode:     "small",
			GroupBy:          "host",
		},
		DefaultView: "overview",
		Notifications: Notifications{
			Statuses: []string{"waiting", "error", "completed"},
		},
		AgentBanner: AgentBanner{
			AutoDismissSeconds: 0,
		},
		QuickSwitcherShortcut:   "ctrl+k",
		SparklinesVisible:       true,
		OverviewRefreshInterval: 5,
		TimestampFormat:         "relative",
		LockTimeoutMinutes:      30,
		LockBackgroundFaster:    true,
		LockBackgroundMinutes:   10,
		FullscreenHideAlerts:    true,
	}
}

type Store struct {
	mu   sync.RWMutex
	path string
	data *Preferences
}

func configDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "guppi"), nil
}

func NewStore() (*Store, error) {
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	s := &Store{
		path: filepath.Join(dir, "preferences.json"),
		data: Default(),
	}

	if err := s.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	return s, nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	// Start from defaults, then overlay saved values
	prefs := Default()
	if err := json.Unmarshal(raw, prefs); err != nil {
		return err
	}
	s.data = prefs
	return nil
}

func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0o644)
}

func (s *Store) Get() *Preferences {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Return a copy
	cp := *s.data
	cp.Sidebar.HiddenSessions = append([]string{}, s.data.Sidebar.HiddenSessions...)
	cp.Notifications.Statuses = append([]string{}, s.data.Notifications.Statuses...)
	return &cp
}

func (s *Store) Update(prefs *Preferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = prefs
	return s.save()
}
