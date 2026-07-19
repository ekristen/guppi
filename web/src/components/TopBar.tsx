import { useState, useEffect, useRef } from 'react'
import { ToolEvent } from '../hooks/useToolEvents'
import { usePreferences } from '../hooks/usePreferences'
import { toolColors, statusConfig } from '../theme'
import { cn } from '../lib/utils'

interface TopBarProps {
  currentView: string
  sidebarCollapsed: boolean
  onToggleCollapse: () => void
  onOverview: () => void
  onSettings: () => void
  onNewSession?: () => void
  events: ToolEvent[]
  connected: boolean | null
  onJumpToSession: (session: string, windowIndex?: number, pane?: string) => void
  onDismiss: (evt: ToolEvent) => void
  onDismissAll: () => void
}

function formatPane(pane?: string): string {
  if (!pane) return ''
  return pane.startsWith('%') ? pane.slice(1) : pane
}

export function TopBar({
  currentView,
  sidebarCollapsed,
  onToggleCollapse,
  onOverview,
  onSettings,
  onNewSession,
  events,
  connected,
  onJumpToSession,
  onDismiss,
  onDismissAll,
}: TopBarProps) {
  const actionable = events.filter(e =>
    e.status === 'waiting' ||
    e.status === 'error' ||
    (e.status === 'completed' && !e.seen)
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  const { prefs } = usePreferences()
  const dismissTimers = useRef<Map<string, number>>(new Map())

  // Auto-dismiss completed events after configured seconds
  useEffect(() => {
    const seconds = prefs.agent_banner.auto_dismiss_seconds
    if (seconds <= 0) return

    events.forEach((evt, i) => {
      if (evt.status !== 'waiting' && evt.status !== 'error') return
      const key = `${evt.tool}-${evt.session}-${evt.pane}-${i}`
      if (dismissTimers.current.has(key)) return
      const timer = window.setTimeout(() => {
        onDismiss(evt)
        dismissTimers.current.delete(key)
      }, seconds * 1000)
      dismissTimers.current.set(key, timer)
    })

    return () => {
      dismissTimers.current.forEach(t => clearTimeout(t))
      dismissTimers.current.clear()
    }
  }, [events, prefs.agent_banner.auto_dismiss_seconds, onDismiss])

  return (
    <header className="flex items-center justify-between px-4 h-12 border-b border-border bg-card shrink-0 font-mono text-sm font-bold">
      {/* Left: Logo + alerts */}
      <div className="flex items-center gap-4 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 cursor-pointer shrink-0" onClick={onOverview}>
          <img src="/icon-192.png" alt="guppi" width="22" height="22" className="rounded-sm" />
          <span className="font-mono text-sm font-bold text-[#7dd3fc]">GUPPI</span>
        </div>

        {/* New session + collapse sidebar */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onNewSession?.()}
            title="New session"
            className="p-1.5 rounded hover:bg-accent text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={onToggleCollapse}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded hover:bg-accent text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="15 18 9 12 15 6" />
              )}
            </svg>
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-border shrink-0" />

        {/* Alert pills */}
        <div className="flex items-center gap-1.5 overflow-hidden">
          {actionable.length === 0 ? (
            <span className="text-xs text-muted-foreground">NO ALERTS</span>
          ) : (
            actionable.map((evt, i) => {
              // Map completed-unseen onto its styled config entry.
              const configKey = evt.status === 'completed' && !evt.seen ? 'completed-unseen' : evt.status
              const config = statusConfig[configKey]
              if (!config) return null
              const toolColor = toolColors[evt.tool] || 'var(--muted-foreground)'
              const key = `${evt.tool}-${evt.session}-${evt.pane}-${i}`
              const isExpanded = expanded === key

              return (
                <div
                  key={key}
                  onMouseEnter={() => setExpanded(key)}
                  onMouseLeave={() => setExpanded(null)}
                  className="flex items-center gap-1.5 py-1 px-2.5 rounded cursor-pointer shrink-0 animate-[alertSlideIn_0.3s_ease-out] transition-all duration-200 overflow-hidden"
                  style={{
                    background: config.bg || `color-mix(in oklch, ${config.color} 10%, transparent)`,
                    border: `1px solid color-mix(in oklch, ${config.color} 25%, transparent)`,
                    maxWidth: isExpanded ? '500px' : '220px',
                  }}
                  onClick={() => onJumpToSession(evt.host ? `${evt.host}/${evt.session}` : evt.session, evt.window, evt.pane)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0 animate-[pulse_1.5s_ease-in-out_infinite]"
                    style={{ background: config.color }}
                  />
                  <span className="text-xs font-semibold shrink-0" style={{ color: toolColor }}>
                    {evt.tool}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: config.color }}>
                    {config.label}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {evt.host_name ? `${evt.host_name}:` : ''}{evt.session}
                  </span>
                  {(evt.window !== undefined || evt.pane) && (
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {evt.window !== undefined ? `w${evt.window}` : ''}{evt.pane ? `:p${formatPane(evt.pane)}` : ''}
                    </span>
                  )}
                  {isExpanded && evt.message && (
                    <span className="text-[11px] text-muted-foreground/60 overflow-hidden text-ellipsis whitespace-nowrap">
                      — {evt.message}
                    </span>
                  )}
                  <span
                    onClick={(e) => { e.stopPropagation(); onDismiss(evt) }}
                    className="text-muted-foreground text-sm leading-none shrink-0 px-0.5 hover:text-foreground"
                  >
                    ×
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Right: Clear, connection, settings, new, collapse */}
      <div className="flex items-center gap-2 shrink-0">
        {actionable.length > 1 && (
          <span
            onClick={onDismissAll}
            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors mr-1"
          >
            Clear
          </span>
        )}
        <div className="flex items-center gap-1 mr-1">
          <div className={`w-2 h-2 rounded-full ${
            connected === true ? 'bg-primary' : connected === false ? 'bg-destructive' : 'bg-muted-foreground'
          } animate-[pulse_1.5s_ease-in-out_infinite]`} />
          <span className={`text-xs ${connected === true ? 'text-muted-foreground' : connected === false ? 'text-destructive' : 'text-muted-foreground'}`}>
            {connected === true ? 'CONNECTED' : connected === false ? 'RECONNECTING' : 'CONNECTING'}
          </span>
        </div>
        <button
          onClick={onSettings}
          title="Settings"
          className={cn(
            'p-1.5 rounded transition-colors',
            currentView === 'settings'
              ? 'bg-accent text-primary'
              : 'hover:bg-accent text-foreground',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
