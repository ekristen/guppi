import { useState, useEffect, useRef } from 'react'
import { Session, sessionKey } from '../hooks/useSessions'
import { ToolEvent } from '../hooks/useToolEvents'
import { ActivitySnapshot } from '../hooks/useActivity'
import { usePreferences } from '../hooks/usePreferences'
import { toolColors, statusConfig } from '../theme'
import { cn } from '../lib/utils'

interface SidebarProps {
  sessions: Session[]
  selectedSession: string | null
  collapsed: boolean
  collapseMode: 'small' | 'hidden'
  hasMultipleHosts?: boolean
  onSessionSelect: (session: Session) => void
  onSessionRenamed?: (oldName: string, newName: string) => void
  getSessionEvents: (session: string) => ToolEvent[]
  sessionNeedsAttention: (session: string) => boolean
  getSessionActivity: (session: string) => ActivitySnapshot | undefined
}

const shellCommands = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'csh', 'tcsh', 'tmux', 'login'])

function isSessionActive(session: Session): boolean {
  if (!session.windows) return false
  return session.windows.some(w =>
    w.panes?.some(p => p.current_command && !shellCommands.has(p.current_command))
  )
}

function ToolBadge({ event }: { event: ToolEvent }) {
  const indicator = statusConfig[event.status]
  if (!indicator) return null
  const toolColor = toolColors[event.tool] || 'var(--muted-foreground)'

  return (
    <div
      title={event.message || `${event.tool}: ${indicator.label}`}
      className="inline-flex items-center gap-[3px] px-[5px] py-[1px] rounded-lg text-[10px]"
      style={{
        background: `${toolColor}18`,
        border: `1px solid ${toolColor}40`,
        color: toolColor,
      }}
    >
      <span
        className={cn('w-[5px] h-[5px] rounded-full inline-block', event.status === 'waiting' && 'animate-[pulse_1.5s_ease-in-out_infinite]')}
        style={{ background: indicator.color }}
      />
      {event.tool}
    </div>
  )
}

function Sparkline({ data, height = 16 }: { data: number[]; height?: number }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  const viewWidth = data.length
  const barWidth = 1
  return (
    <svg viewBox={`0 0 ${viewWidth} ${height}`} preserveAspectRatio="none" width="100%" height={height} className="block">
      {data.map((val, i) => {
        const barHeight = (val / max) * height
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={height - barHeight}
            width={Math.max(barWidth - 0.05, 0.05)}
            height={barHeight}
            style={{ fill: val > 0 ? 'var(--chart-primary)' : 'var(--muted)' }}
            opacity={val > 0 ? 0.7 : 0.3}
          />
        )
      })}
    </svg>
  )
}

function getHiddenSessions(): Set<string> {
  try {
    const stored = localStorage.getItem('guppi:hidden-sessions')
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

// Events the user actually needs to act on: any waiting/error or a
// completed event the user hasn't acknowledged yet.
function alertEvents(events: ToolEvent[]): ToolEvent[] {
  return events.filter(e =>
    e.status === 'waiting' || e.status === 'error' || (e.status === 'completed' && !e.seen)
  )
}

function setHiddenSessions(hidden: Set<string>) {
  localStorage.setItem('guppi:hidden-sessions', JSON.stringify([...hidden]))
}

export function Sidebar({
  sessions,
  selectedSession,
  collapsed,
  collapseMode,
  hasMultipleHosts,
  onSessionSelect,
  onSessionRenamed,
  getSessionEvents,
  sessionNeedsAttention,
  getSessionActivity,
}: SidebarProps) {
  const { prefs } = usePreferences()
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => getHiddenSessions())
  const [hiddenExpanded, setHiddenExpanded] = useState(false)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ session: string; x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingSession && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingSession])

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const visibleSessions = [...sessions.filter(s => !hiddenSet.has(s.name))].sort((a, b) => a.name.localeCompare(b.name))
  const hiddenSessions = sessions.filter(s => hiddenSet.has(s.name))

  const toggleHide = (name: string) => {
    const next = new Set(hiddenSet)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setHiddenSet(next)
    setHiddenSessions(next)
    setContextMenu(null)
  }

  const startRename = (name: string) => {
    setRenamingSession(name)
    setRenameValue(name)
    setContextMenu(null)
  }

  const submitRename = async () => {
    if (!renamingSession || !renameValue.trim() || renameValue === renamingSession) {
      setRenamingSession(null)
      return
    }
    try {
      const res = await fetch('/api/session/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: renamingSession, new_name: renameValue.trim() }),
      })
      if (res.ok) {
        if (hiddenSet.has(renamingSession)) {
          const next = new Set(hiddenSet)
          next.delete(renamingSession)
          next.add(renameValue.trim())
          setHiddenSet(next)
          setHiddenSessions(next)
        }
        onSessionRenamed?.(renamingSession, renameValue.trim())
      }
    } catch (err) {
      console.error('Failed to rename session:', err)
    }
    setRenamingSession(null)
  }

  const renderSessionItem = (session: Session, isHiddenSection = false) => {
    const sk = sessionKey(session)
    const isSelected = selectedSession === sk
    const needsAttention = sessionNeedsAttention(sk)
    const events = getSessionEvents(sk)
    const act = getSessionActivity(sk)
    const active = isSessionActive(session)
    const isRenaming = renamingSession === session.name
    const isOffline = session.host && session.host_online === false

    return (
      <li key={sk}>
        <button
          onClick={() => !isRenaming && onSessionSelect(session)}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ session: session.name, x: e.clientX, y: e.clientY })
          }}
          className={cn(
            'flex flex-col w-full p-3 rounded transition-all duration-200',
            'hover:bg-sidebar-accent text-sidebar-foreground',
            isSelected && 'bg-sidebar-accent text-sidebar-primary border-l-2 border-primary',
            needsAttention && !isSelected && 'border-l-2 border-warning bg-warning/5',
            !isSelected && !needsAttention && 'border-l-2 border-transparent',
            (isHiddenSection || isOffline) && 'opacity-60',
            isRenaming && 'cursor-default',
          )}
        >
          {/* Row 1: name + status */}
          <div className="flex items-center gap-2 w-full">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenamingSession(null)
                }}
                onBlur={submitRename}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 text-sm text-foreground bg-input border border-primary rounded px-1 py-0.5 outline-none font-mono"
              />
            ) : (
              <span className={cn(
                'tracking-wide flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left',
                isSelected && 'text-primary',
              )}>
                {collapsed ? session.name.charAt(0).toUpperCase() : session.name}
              </span>
            )}
            {!collapsed && session.attached && (
              <span className="w-2 h-2 rounded-full bg-success shrink-0" title="attached" />
            )}
            {!collapsed && active && (
              <span className="text-[10px] text-success shrink-0">active</span>
            )}
          </div>

          {/* Row 2: sparkline */}
          {!collapsed && prefs.sparklines_visible && act && act.sparkline && (
            <div className={cn('mt-1.5 w-full', alertEvents(events).length > 0 && 'mb-1')}>
              <Sparkline data={act.sparkline} height={14} />
            </div>
          )}

          {/* Row 3: agent badges */}
          {!collapsed && alertEvents(events).length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {alertEvents(events).map((evt, i) => (
                <ToolBadge key={`${evt.tool}-${evt.pane}-${i}`} event={evt} />
              ))}
            </div>
          )}
        </button>
      </li>
    )
  }

  const isHidden = collapsed && collapseMode === 'hidden'

  return (
    <aside className={cn(
      'flex flex-col h-full bg-sidebar transition-all duration-300 font-mono text-sm font-bold',
      collapsed
        ? collapseMode === 'hidden' ? 'w-0 overflow-hidden' : 'w-16'
        : 'w-56',
      !isHidden && 'border-r border-sidebar-border',
    )}>
      {/* Session list */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {sessions.length === 0 && (
            <li className="p-3 text-muted-foreground text-sm">
              {collapsed ? '—' : 'No sessions'}
            </li>
          )}

          {(prefs.sidebar.group_by || 'host') === 'project' ? (
            // Group by project — sessions without a derived project land under "ungrouped".
            (() => {
              const groups = new Map<string, Session[]>()
              for (const s of visibleSessions) {
                const label = s.project || 'ungrouped'
                if (!groups.has(label)) groups.set(label, [])
                groups.get(label)!.push(s)
              }
              return Array.from(groups.entries()).sort(([a], [b]) => {
                // Ungrouped always last, then alphabetical.
                if (a === 'ungrouped') return 1
                if (b === 'ungrouped') return -1
                return a.localeCompare(b)
              }).map(([projectLabel, projSessions]) => {
                const alertCount = projSessions.reduce((acc, s) => {
                  const evts = getSessionEvents(sessionKey(s))
                  return acc + evts.filter(e => e.status === 'waiting' || e.status === 'error' || (e.status === 'completed' && !e.seen)).length
                }, 0)
                return (
                  <li key={projectLabel}>
                    {!collapsed && (
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                        <span className="flex-1 truncate">{projectLabel}</span>
                        {alertCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-warning/20 text-warning font-mono">
                            {alertCount}
                          </span>
                        )}
                      </div>
                    )}
                    <ul className="space-y-0.5">
                      {projSessions.map(session => renderSessionItem(session))}
                    </ul>
                  </li>
                )
              })
            })()
          ) : (prefs.sidebar.group_by || 'host') === 'none' || !hasMultipleHosts ? (
            // Flat list when group_by == 'none' or there is only one host and grouping is the default.
            visibleSessions.map((session) => renderSessionItem(session))
          ) : (
            // Default: group by host
            (() => {
              const groups = new Map<string, Session[]>()
              for (const s of visibleSessions) {
                const hostLabel = s.host_name || 'Local'
                if (!groups.has(hostLabel)) groups.set(hostLabel, [])
                groups.get(hostLabel)!.push(s)
              }
              return Array.from(groups.entries()).sort(([a], [b]) => a === 'Local' ? -1 : b === 'Local' ? 1 : a.localeCompare(b)).map(([hostLabel, hostSessions]) => (
                <li key={hostLabel}>
                  {!collapsed && (
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        hostSessions[0]?.host_online !== false ? 'bg-success' : 'bg-muted-foreground',
                      )} />
                      {hostLabel}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {hostSessions.map(session => renderSessionItem(session))}
                  </ul>
                </li>
              ))
            })()
          )}

          {/* Hidden sessions */}
          {hiddenSessions.length > 0 && !collapsed && (
            <>
              <li
                onClick={() => setHiddenExpanded(!hiddenExpanded)}
                className="px-3 mt-2 text-[11px] text-muted-foreground cursor-pointer select-none flex items-center gap-1"
              >
                <span
                  className="inline-block text-[10px] transition-transform duration-150"
                  style={{ transform: hiddenExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  ▶
                </span>
                Hidden ({hiddenSessions.length})
              </li>
              {hiddenExpanded && hiddenSessions.map((session) => renderSessionItem(session, true))}
            </>
          )}
        </ul>
      </nav>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-popover border border-border rounded-md py-1 z-[1000] shadow-lg min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            onClick={() => startRename(contextMenu.session)}
            className="px-3 py-1.5 text-sm text-popover-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground"
          >
            Rename
          </div>
          <div
            onClick={() => toggleHide(contextMenu.session)}
            className="px-3 py-1.5 text-sm text-popover-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground"
          >
            {hiddenSet.has(contextMenu.session) ? 'Unhide' : 'Hide'}
          </div>
        </div>
      )}
    </aside>
  )
}
