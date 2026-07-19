import { useCallback, useRef, useContext } from 'react'
import { ToolEvent } from './useToolEvents'
import { PreferencesContext } from './usePreferences'

/**
 * useNotifications handles browser desktop notifications for tool events.
 * When push notifications are subscribed, browser notifications are skipped
 * (the service worker handles them instead).
 */
export function useNotifications(pushSubscribed = false) {
  const prevEventsRef = useRef<Map<string, ToolEvent>>(new Map())
  const browserNotifs = useRef<Map<string, globalThis.Notification>>(new Map())
  const { prefs } = useContext(PreferencesContext)
  const pushSubscribedRef = useRef(pushSubscribed)
  pushSubscribedRef.current = pushSubscribed

  const processToolEvent = useCallback((evt: ToolEvent) => {
    const key = `${evt.host || ''}:${evt.session}:${evt.window}:${evt.pane || ''}`
    const prev = prevEventsRef.current.get(key)

    // Determine if this transition is worth a browser notification.
    // Completed events fire only when the agent hasn't been seen yet —
    // once the user views the session (≥2s dwell), MarkSeen flips seen=true
    // and subsequent re-fetches of the matched event stop triggering.
    const enabledStatuses = prefs.notifications.statuses
    let shouldNotify = false
    if (evt.status === 'waiting' && prev?.status !== 'waiting' && enabledStatuses.includes('waiting')) {
      shouldNotify = true
    } else if (evt.status === 'error' && prev?.status !== 'error' && enabledStatuses.includes('error')) {
      shouldNotify = true
    } else if (evt.status === 'completed' && !evt.seen && prev?.seen !== false && enabledStatuses.includes('completed')) {
      shouldNotify = true
    }

    // When a tool transitions away from waiting/error to active/completed
    // (e.g. user is back in control), close any browser notification we
    // raised for this key. Don't close on waiting-to-waiting (re-prompts);
    // the original behavior is preserved.
    if (evt.status === 'active' || evt.status === 'completed') {
      const existing = browserNotifs.current.get(key)
      if (existing) {
        existing.close()
        browserNotifs.current.delete(key)
      }
    }

    // Update prev state
    if (evt.status === 'completed' && (evt.seen || !shouldNotify)) {
      // Either acknowledged or never triggered: drop from prev so a future
      // unseen-completion can fire again.
      prevEventsRef.current.delete(key)
    } else {
      prevEventsRef.current.set(key, evt)
    }

    if (!shouldNotify) return

    // Browser notification when push isn't handling it
    if (!pushSubscribedRef.current) {
      const title = evt.status === 'waiting'
        ? `${evt.tool} needs input`
        : evt.status === 'error'
        ? `${evt.tool} error`
        : `${evt.tool} finished — review needed`
      const body = evt.status === 'waiting'
        ? `Waiting in session "${evt.session}"${evt.message ? `: ${evt.message}` : ''}`
        : evt.status === 'error'
        ? `Error in session "${evt.session}"${evt.message ? `: ${evt.message}` : ''}`
        : `Completed in session "${evt.session}"${evt.message ? `: ${evt.message}` : ''}`

      if ('Notification' in window && globalThis.Notification.permission === 'granted') {
        const n = new globalThis.Notification(title, { body, icon: '/favicon.ico' })
        browserNotifs.current.set(key, n)
        n.onclose = () => browserNotifs.current.delete(key)
      }
    }
  }, [prefs.notifications.statuses])

  return { processToolEvent }
}
