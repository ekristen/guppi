import { useCallback, useRef, useContext } from 'react'
import { ToolEvent } from './useToolEvents'
import { PreferencesContext } from './usePreferences'

/**
 * useNotifications handles browser desktop notifications for tool events.
 * Browser notifications are always shown when the app is open. If push
 * notifications also fire, the service worker deduplicates via the tag field.
 */
export function useNotifications() {
  const prevEventsRef = useRef<Map<string, ToolEvent>>(new Map())
  const browserNotifs = useRef<Map<string, globalThis.Notification>>(new Map())
  const { prefs } = useContext(PreferencesContext)

  const processToolEvent = useCallback((evt: ToolEvent) => {
    const key = `${evt.host || ''}:${evt.session}:${evt.window}:${evt.pane || ''}`
    const prev = prevEventsRef.current.get(key)

    // When a tool transitions away from waiting/error, close browser notification
    if (evt.status === 'active' || evt.status === 'completed') {
      const existing = browserNotifs.current.get(key)
      if (existing) {
        existing.close()
        browserNotifs.current.delete(key)
      }
    }

    // Determine if this transition is worth a browser notification
    const enabledStatuses = prefs.notifications.statuses
    let shouldNotify = false
    if (evt.status === 'waiting' && prev?.status !== 'waiting' && enabledStatuses.includes('waiting')) {
      shouldNotify = true
    } else if (evt.status === 'error' && prev?.status !== 'error' && enabledStatuses.includes('error')) {
      shouldNotify = true
    }

    // Update prev state
    if (evt.status === 'completed') {
      prevEventsRef.current.delete(key)
    } else {
      prevEventsRef.current.set(key, evt)
    }

    if (!shouldNotify) return

    // Show browser notification (service worker deduplicates via tag if push also fires)
    const title = evt.status === 'waiting'
      ? `${evt.tool} needs input`
      : `${evt.tool} error`
    const body = `${evt.status === 'waiting' ? 'Waiting' : 'Error'} in session "${evt.session}"${evt.message ? `: ${evt.message}` : ''}`

    if ('Notification' in window && globalThis.Notification.permission === 'granted') {
      const n = new globalThis.Notification(title, { body, icon: '/favicon.ico' })
      browserNotifs.current.set(key, n)
      n.onclose = () => browserNotifs.current.delete(key)
    }
  }, [prefs.notifications.statuses])

  return { processToolEvent }
}
