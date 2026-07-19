import { useState, useEffect, useCallback } from 'react'

export interface Pane {
  id: string
  window_id: string
  session_id: string
  index: number
  active: boolean
  width: number
  height: number
  current_command: string
  pid: number
}

export interface Window {
  id: string
  session_id: string
  name: string
  index: number
  active: boolean
  layout: string
  panes: Pane[]
}

export interface Session {
  id: string
  name: string
  host?: string        // peer fingerprint (empty = local)
  host_name?: string   // peer display name
  host_online?: boolean
  windows: Window[]
  project?: string
  created: string
  attached: boolean
  last_activity: string
}

// Unique key for a session across hosts
export function sessionKey(session: Session): string {
  return session.host ? `${session.host}/${session.name}` : session.name
}

// Parse a session key back into host + name
export function parseSessionKey(key: string): { host: string; name: string } {
  const idx = key.indexOf('/')
  if (idx === -1) return { host: '', name: key }
  return { host: key.substring(0, idx), name: key.substring(idx + 1) }
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data || [])
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { sessions, loading, refresh }
}
