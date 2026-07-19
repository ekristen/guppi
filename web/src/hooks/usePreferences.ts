import { useState, useEffect, useCallback, createContext, useContext } from 'react'

export interface Preferences {
  terminal: {
    font_size: number
    font_family: string
    scrollback: number
  }
  theme: string
  custom_theme: Record<string, string>
  sidebar: {
    default_collapsed: boolean
    hidden_sessions: string[]
    collapse_mode: string
    group_by?: 'host' | 'project' | 'none'
  }
  default_view: string
  notifications: {
    statuses: string[]
  }
  agent_banner: {
    auto_dismiss_seconds: number
  }
  quick_switcher_shortcut: string
  sparklines_visible: boolean
  overview_refresh_interval: number
  timestamp_format: string
  lock_timeout_minutes: number
  lock_background_faster: boolean
  lock_background_minutes: number
  fullscreen_hide_alerts: boolean
}

export const defaultPreferences: Preferences = {
  terminal: {
    font_size: 13,
    font_family: 'Space Mono',
    scrollback: 5000,
  },
  theme: 'retro-blue',
  custom_theme: {},
  sidebar: {
    default_collapsed: false,
    hidden_sessions: [],
    collapse_mode: 'small',
    group_by: 'host',
  },
  default_view: 'overview',
  notifications: {
    statuses: ['waiting', 'error', 'completed'],
  },
  agent_banner: {
    auto_dismiss_seconds: 0,
  },
  quick_switcher_shortcut: 'ctrl+k',
  sparklines_visible: true,
  overview_refresh_interval: 5,
  timestamp_format: 'relative',
  lock_timeout_minutes: 30,
  lock_background_faster: true,
  lock_background_minutes: 10,
  fullscreen_hide_alerts: true,
}

interface PreferencesContextValue {
  prefs: Preferences
  updatePrefs: (partial: Partial<Preferences>) => Promise<void>
  loaded: boolean
  refetch: () => Promise<void>
}

export const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: defaultPreferences,
  updatePrefs: async () => {},
  loaded: false,
  refetch: async () => {},
})

export function usePreferencesProvider() {
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences)
  const [loaded, setLoaded] = useState(false)

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch('/api/preferences')
      if (!res.ok) return // don't parse 401/error responses as prefs
      const data = await res.json()
      // Validate shape before accepting
      if (data && typeof data.theme === 'string' && data.terminal) {
        setPrefs(data)
      }
    } catch {
      // ignore fetch errors
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    fetchPrefs()
  }, [fetchPrefs])

  const updatePrefs = useCallback(async (partial: Partial<Preferences>) => {
    const merged = { ...prefs, ...partial }
    setPrefs(merged)
    try {
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (res.ok) {
        const saved = await res.json()
        setPrefs(saved)
      }
    } catch (err) {
      console.error('Failed to save preferences:', err)
    }
  }, [prefs])

  return { prefs, updatePrefs, loaded, refetch: fetchPrefs }
}

export function usePreferences() {
  return useContext(PreferencesContext)
}
