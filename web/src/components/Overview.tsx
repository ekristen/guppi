import { useState, useEffect } from 'react'
import { Session, sessionKey } from '../hooks/useSessions'
import { Host } from '../hooks/useHosts'
import { ToolEvent } from '../hooks/useToolEvents'
import { ActivitySnapshot } from '../hooks/useActivity'
import { usePreferences } from '../hooks/usePreferences'
import { toolColors, statusConfig } from '../theme'

interface OverviewProps {
  sessions: Session[]
  hosts: Host[]
  onSessionSelect: (session: Session) => void
  getSessionEvents: (session: string) => ToolEvent[]
  getSessionActivity: (session: string) => ActivitySnapshot | undefined
  pendingAlerts: ToolEvent[]
  onJumpToSession: (session: string, windowIndex?: number, pane?: string) => void
  onDismissAlert: (evt: ToolEvent) => void
}

interface SystemStats {
  os: string
  arch: string
  cpus: number
  goroutines: number
  guppi_mem_mb: number
  load?: { '1m': number; '5m': number; '15m': number }
  uptime_seconds?: number
  memory?: { total_mb: number; used_mb: number; available_mb: number; percent: number }
  cpu_percent?: number
  processes?: { name: string; count: number }[]
}

interface Stats {
  sessions: { total: number; attached: number; detached: number }
  windows: number
  panes: number
  agent_panes: number
  agents: { active: number; waiting: number; error: number }
  processes: { name: string; count: number }[]
  system?: SystemStats
}

const agentCommands = new Set(['claude', 'codex', 'copilot', 'opencode'])
const shellCommands = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'csh', 'tcsh', 'tmux', 'login'])

function isSessionActive(session: Session): boolean {
  if (!session.windows) return false
  return session.windows.some(w =>
    w.panes?.some(p => p.current_command && !shellCommands.has(p.current_command))
  )
}

function Sparkline({ data, height = 20 }: { data: number[]; height?: number }) {
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

function formatUptime(created: string, format: string = 'relative'): string {
  if (format === 'absolute') {
    return new Date(created).toLocaleTimeString()
  }
  const diff = Date.now() - new Date(created).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return `${Math.floor(diff / 60000)}m`
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatSystemUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function UsageBar({ percent, color, label }: { percent: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[11px] text-muted-foreground text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-background rounded overflow-hidden">
        <div
          className="h-full rounded transition-[width] duration-300"
          style={{
            width: `${Math.min(percent, 100)}%`,
            background: percent > 90 ? 'var(--destructive)' : percent > 70 ? 'var(--warning)' : color,
          }}
        />
      </div>
      <span className="w-8 text-[11px] text-muted-foreground shrink-0">{percent}%</span>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex-1 min-w-[90px]">
      <div className="text-2xl font-bold" style={{ color: color || 'var(--color-foreground)' }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  )
}

function ProcessBar({ processes, totalPanes }: { processes: { name: string; count: number }[]; totalPanes: number }) {
  if (processes.length === 0) return null
  const max = processes[0]?.count || 1

  return (
    <div className="flex flex-col gap-1.5">
      {processes.slice(0, 10).map(p => {
        const isAgent = agentCommands.has(p.name)
        const pct = totalPanes > 0 ? (p.count / totalPanes) * 100 : 0
        return (
          <div key={p.name} className="flex items-center gap-2">
            <span
              className="w-[90px] text-xs text-right overflow-hidden text-ellipsis whitespace-nowrap shrink-0"
              style={{
                color: isAgent ? (toolColors[p.name] || 'var(--chart-secondary)') : 'var(--color-muted-foreground)',
                fontWeight: isAgent ? 600 : 400,
              }}
            >
              {p.name}
            </span>
            <div className="flex-1 h-[14px] bg-background rounded overflow-hidden">
              <div
                className="h-full rounded min-w-[2px]"
                style={{
                  width: `${(p.count / max) * 100}%`,
                  background: isAgent ? (toolColors[p.name] || 'var(--chart-secondary)') : 'var(--color-border)',
                }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground/60 w-[45px] shrink-0">
              {p.count} ({Math.round(pct)}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SystemStatsCard({ system }: { system: SystemStats }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3">
      {system.cpu_percent !== undefined && (
        <UsageBar percent={system.cpu_percent} color="var(--chart-primary)" label="CPU" />
      )}
      {system.memory && (
        <UsageBar percent={system.memory.percent} color="var(--chart-secondary)" label="MEM" />
      )}
      <div className="grid grid-cols-2 gap-2 mt-1">
        {system.load && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 mb-0.5">Load Average</div>
            <div className="text-[13px] text-foreground font-mono">
              {system.load['1m'].toFixed(2)}{' '}
              <span className="text-muted-foreground">{system.load['5m'].toFixed(2)}</span>{' '}
              <span className="text-muted-foreground/60">{system.load['15m'].toFixed(2)}</span>
            </div>
          </div>
        )}
        {system.memory && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 mb-0.5">Memory</div>
            <div className="text-[13px] text-foreground">
              {(system.memory.used_mb / 1024).toFixed(1)}
              <span className="text-muted-foreground/60"> / {(system.memory.total_mb / 1024).toFixed(1)} GB</span>
            </div>
          </div>
        )}
        {system.uptime_seconds !== undefined && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 mb-0.5">System Uptime</div>
            <div className="text-[13px] text-foreground">
              {formatSystemUptime(system.uptime_seconds)}
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">CPUs</div>
          <div className="text-[13px] text-foreground">
            {system.cpus} <span className="text-muted-foreground/60">{system.arch}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">Guppi Memory</div>
          <div className="text-[13px] text-foreground">
            {system.guppi_mem_mb.toFixed(1)} MB
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">Goroutines</div>
          <div className="text-[13px] text-foreground">
            {system.goroutines}
          </div>
        </div>
      </div>
    </div>
  )
}

function HostStatsSection({ host, totalPanes }: { host: Host; totalPanes: number }) {
  const hostStats = host.stats as SystemStats | undefined
  if (!hostStats) return null

  const processes = hostStats.processes || []

  return (
    <div className="mb-6">
      <h3 className="text-foreground text-sm font-semibold mb-2.5 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${host.online ? 'bg-success' : 'bg-muted-foreground'}`} />
        {host.name}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-3">
        {processes.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Processes</div>
            <div className="bg-card border border-border rounded-lg p-3.5">
              <ProcessBar processes={processes} totalPanes={totalPanes} />
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">System</div>
          <SystemStatsCard system={hostStats} />
        </div>
      </div>
    </div>
  )
}

export function Overview({
  sessions,
  hosts,
  onSessionSelect,
  getSessionEvents,
  getSessionActivity,
  pendingAlerts,
  onJumpToSession,
  onDismissAlert,
}: OverviewProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const { prefs } = usePreferences()
  const hasMultipleHosts = hosts.length > 1

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats')
        if (res.ok) setStats(await res.json())
      } catch {}
    }
    fetchStats()
    const ms = (prefs.overview_refresh_interval || 5) * 1000
    const interval = setInterval(fetchStats, ms)
    return () => clearInterval(interval)
  }, [prefs.overview_refresh_interval])

  return (
    <div className="flex-1 p-6 overflow-y-auto font-mono text-sm font-bold">
      {/* Stat cards */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {hasMultipleHosts && (
          <StatCard
            label="Hosts"
            value={hosts.filter(h => h.online).length}
            sub={`${hosts.length} total`}
            color="var(--chart-primary)"
          />
        )}
        <StatCard
          label="Sessions"
          value={stats?.sessions.total ?? sessions.length}
          sub={stats ? `${stats.sessions.attached} attached` : undefined}
        />
        <StatCard
          label="Windows"
          value={stats?.windows ?? sessions.reduce((n, s) => n + (s.windows?.length || 0), 0)}
        />
        <StatCard
          label="Panes"
          value={stats?.panes ?? '—'}
          sub={stats && stats.agent_panes > 0 ? `${stats.agent_panes} agents` : undefined}
        />
        <StatCard
          label="Agents Active"
          value={stats?.agents.active ?? 0}
          color="var(--success)"
        />
        <StatCard
          label="Waiting"
          value={stats?.agents.waiting ?? 0}
          color={stats && stats.agents.waiting > 0 ? 'var(--warning)' : 'var(--color-muted-foreground)'}
        />
      </div>

      {/* Pending alerts */}
      {pendingAlerts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-foreground text-sm font-semibold mb-2.5">
            Pending Alerts ({pendingAlerts.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {pendingAlerts.map((evt, i) => {
              const cfg = statusConfig[evt.status] || { color: 'var(--muted-foreground)', label: evt.status, bg: 'transparent' }
              const tc = toolColors[evt.tool] || 'var(--muted-foreground)'
              return (
                <div
                  key={`${evt.tool}-${evt.session}-${evt.pane}-${i}`}
                  className="bg-card rounded-md p-2.5 px-3.5 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-sidebar-accent"
                  style={{
                    border: `1px solid color-mix(in oklch, ${cfg.color} 20%, transparent)`,
                    borderLeft: `3px solid ${cfg.color}`,
                  }}
                  onClick={() => onJumpToSession(evt.host ? `${evt.host}/${evt.session}` : evt.session, evt.window, evt.pane)}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${evt.status === 'waiting' ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : ''}`}
                    style={{ background: cfg.color }}
                  />
                  <span className="font-semibold text-[13px]" style={{ color: tc }}>{evt.tool}</span>
                  <span className="text-xs" style={{ color: cfg.color }}>{cfg.label}</span>
                  <span className="text-muted-foreground text-xs">in</span>
                  <span className="text-foreground font-semibold text-xs">{evt.host_name ? `${evt.host_name}: ` : ''}{evt.session}</span>
                  {evt.message && (
                    <span className="text-muted-foreground/60 text-[11px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      — {evt.message}
                    </span>
                  )}
                  <span
                    onClick={(e) => { e.stopPropagation(); onDismissAlert(evt) }}
                    className="text-muted-foreground text-base cursor-pointer leading-none hover:text-foreground"
                  >×</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sessions grid */}
      {sessions.length === 0 && (
        <div className="text-muted-foreground text-sm mb-6">
          No tmux sessions found. Start a tmux session to get started.
        </div>
      )}
      {(() => {
        const groups = new Map<string, Session[]>()
        for (const s of sessions) {
          const label = hasMultipleHosts ? (s.host_name || 'Local') : 'Sessions'
          if (!groups.has(label)) groups.set(label, [])
          groups.get(label)!.push(s)
        }
        const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
          a === 'Local' || a === 'Sessions' ? -1 : b === 'Local' || b === 'Sessions' ? 1 : a.localeCompare(b)
        )
        return sortedGroups.map(([groupLabel, groupSessions]) => (
          <div key={groupLabel} className="mb-6">
            <h3 className="text-foreground text-sm font-semibold mb-2.5 flex items-center gap-2">
              {hasMultipleHosts && (
                <span className={`w-1.5 h-1.5 rounded-full ${
                  groupSessions[0]?.host_online !== false ? 'bg-success' : 'bg-muted-foreground'
                }`} />
              )}
              {groupLabel}
              <span className="text-muted-foreground/60 font-normal text-xs">({groupSessions.length})</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3">
              {groupSessions.map((session) => {
                const sk = sessionKey(session)
                const events = getSessionEvents(sk)
                const hasWaiting = events.some(e => e.status === 'waiting')
                const act = getSessionActivity(sk)
                const active = isSessionActive(session)
                const isOffline = session.host && session.host_online === false
                // Count agents by pane command name OR by tool event detection
                // (catches agents like codex/copilot that show as "node")
                const eventPanes = new Set(events.map(e => e.pane).filter(Boolean))
                const agentCount = (session.windows || []).reduce((n, w) =>
                  n + (w.panes || []).filter(p => agentCommands.has(p.current_command) || eventPanes.has(p.id)).length, 0)

                return (
                  <div
                    key={sk}
                    onClick={() => onSessionSelect(session)}
                    className={`bg-card rounded-lg p-3.5 cursor-pointer transition-colors hover:border-primary/40 ${isOffline ? 'opacity-60' : ''}`}
                    style={{
                      border: `1px solid ${hasWaiting ? 'var(--warning)' : 'var(--color-border)'}`,
                    }}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-foreground">{session.name}</span>
                      {session.attached && (
                        <span className="text-[10px] text-success px-1.5 py-[1px] rounded-lg bg-success/10 border border-success/20">
                          attached
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground/60">
                        up {formatUptime(session.created, prefs.timestamp_format)}
                      </span>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground">
                      <span>{session.windows?.length || 0} windows</span>
                      {agentCount > 0 && (
                        <span style={{ color: toolColors.claude }}>{agentCount} agent{agentCount > 1 ? 's' : ''}</span>
                      )}
                      {active ? (
                        <span className="text-success">active</span>
                      ) : (
                        <span className="text-muted-foreground/60">idle</span>
                      )}
                    </div>

                    {/* Sparkline */}
                    {prefs.sparklines_visible && act && act.sparkline && (
                      <div className={events.length > 0 ? 'mb-2' : ''}>
                        <Sparkline data={act.sparkline} height={18} />
                      </div>
                    )}

                    {/* Agent status — commented out for now
                    {events.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {events.map((evt, i) => {
                          const config = statusConfig[evt.status]
                          const tc = toolColors[evt.tool] || 'var(--muted-foreground)'
                          if (!config) return null
                          return (
                            <div
                              key={`${evt.tool}-${evt.pane}-${i}`}
                              className="flex items-center gap-1.5 py-1 px-2 rounded text-[11px]"
                              style={{ background: config.bg }}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${evt.status === 'waiting' ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : ''}`}
                                style={{ background: config.color }}
                              />
                              <span className="font-semibold" style={{ color: tc }}>{evt.tool}</span>
                              <span className="text-muted-foreground">{config.label}</span>
                              {evt.message && (
                                <span className="text-muted-foreground/60 ml-auto overflow-hidden text-ellipsis whitespace-nowrap text-[10px]">
                                  {evt.message}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    */}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      })()}

      {/* Per-host processes + system stats */}
      {hasMultipleHosts ? (
        hosts.filter(h => h.stats).map(host => {
          const paneCount = (host.sessions || []).reduce((n, s: any) =>
            n + (s.windows || []).reduce((wn: number, w: any) => wn + (w.panes || []).length, 0), 0)
          return <HostStatsSection key={host.id} host={host} totalPanes={paneCount} />
        })
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-3">
          {stats && stats.processes && stats.processes.length > 0 && (
            <div>
              <h3 className="text-foreground text-sm font-semibold mb-2.5">Processes</h3>
              <div className="bg-card border border-border rounded-lg p-3.5">
                <ProcessBar processes={stats.processes} totalPanes={stats.panes} />
              </div>
            </div>
          )}

          {stats?.system && (
            <div>
              <h3 className="text-foreground text-sm font-semibold mb-2.5">System</h3>
              <SystemStatsCard system={stats.system} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
