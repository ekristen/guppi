import { useState, useEffect, useCallback } from 'react'
import { parseSessionKey } from './useSessions'

export interface ToolEvent {
  tool: string
  status: 'active' | 'waiting' | 'completed' | 'error'
  host?: string
  host_name?: string
  session: string
  window: number
  pane?: string
  message?: string
  timestamp: string
  auto_detected?: boolean
  seen?: boolean
  expires_at?: string
}

export function useToolEvents() {
  const [events, setEvents] = useState<ToolEvent[]>([])

  // Fetch initial state
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tool-events')
      if (res.ok) {
        const data = await res.json()
        setEvents(data || [])
      }
    } catch (err) {
      console.error('Failed to fetch tool events:', err)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Periodic re-sync to catch missed WebSocket messages
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  // Handle incoming WebSocket tool events
  const handleEvent = useCallback((evt: any) => {
    if (evt.type !== 'tool-event') return

    const toolEvt: ToolEvent = {
      tool: evt.tool,
      status: evt.status,
      host: evt.host,
      host_name: evt.host_name,
      session: evt.session,
      window: evt.window,
      pane: evt.pane,
      message: evt.message,
      timestamp: evt.timestamp,
      auto_detected: evt.auto_detected,
      seen: evt.seen,
      expires_at: evt.expires_at,
    }

    setEvents(prev => {
      // Remove existing event for same host/session/window/pane
      // Normalize pane to handle undefined vs empty string
      const filtered = prev.filter(
        e => !(e.session === toolEvt.session && e.window === toolEvt.window && (e.pane || '') === (toolEvt.pane || '') && (e.host || '') === (toolEvt.host || ''))
      )
      // Keep auto-detected active events so they count toward agent totals;
      // hook-based active events are transient and should be cleared.
      // Completed events are retained (with a seen flag) so the UI can
      // surface a "DONE — review needed" alert; the server reaps them
      // after the configured TTL.
      if (toolEvt.status === 'active' && !toolEvt.auto_detected) {
        return filtered
      }
      return [...filtered, toolEvt]
    })
  }, [])

  // Get events for a specific session (accepts composite key: "host/name" or "name")
  const getSessionEvents = useCallback((key: string) => {
    const idx = key.indexOf('/')
    if (idx === -1) {
      // Local session — match events with no host
      return events.filter(e => e.session === key && !e.host)
    }
    const host = key.substring(0, idx)
    const name = key.substring(idx + 1)
    return events.filter(e => e.session === name && e.host === host)
  }, [events])

  // Check if a session has any "waiting" events (accepts composite key)
  const sessionNeedsAttention = useCallback((key: string) => {
    const idx = key.indexOf('/')
    if (idx === -1) {
      return events.some(e => e.session === key && !e.host && e.status === 'waiting')
    }
    const host = key.substring(0, idx)
    const name = key.substring(idx + 1)
    return events.some(e => e.session === name && e.host === host && e.status === 'waiting')
  }, [events])

  // Mark all completed events for a session as seen (dismisses the
  // "DONE — review needed" alert). Optimistic local update + server
  // POST; idempotent on the server side.
  const markSessionSeen = useCallback(async (sessKey: string) => {
    const { host, name } = parseSessionKey(sessKey)
    let touched = false
    setEvents(prev => prev.map(e => {
      if (e.status !== 'completed') return e
      if (e.session !== name) return e
      if ((e.host || '') !== host) return e
      if (e.seen) return e
      touched = true
      return { ...e, seen: true }
    }))
    if (!touched) return
    try {
      await fetch('/api/tool-events/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, session: name }),
      })
    } catch (err) {
      console.error('Failed to mark session seen:', err)
    }
  }, [])

  // Dismiss a specific event (clear from server and local state)
  const dismissEvent = useCallback(async (evt: ToolEvent) => {
    try {
      await fetch('/api/tool-event', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: evt.host || '', session: evt.session, window: evt.window, pane: evt.pane || '' }),
      })
    } catch (err) {
      console.error('Failed to dismiss event:', err)
    }
    setEvents(prev => prev.filter(
      e => !(e.session === evt.session && e.window === evt.window && (e.pane || '') === (evt.pane || '') && (e.host || '') === (evt.host || ''))
    ))
  }, [])

  // Clear all events
  const dismissAll = useCallback(async () => {
    try {
      await fetch('/api/tool-events', { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to clear events:', err)
    }
    setEvents([])
  }, [])

  return { events, handleEvent, getSessionEvents, sessionNeedsAttention, dismissEvent, dismissAll, markSessionSeen, refresh }
}
