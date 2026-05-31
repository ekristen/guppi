import { useState, useEffect } from 'react'
import { Session } from '../hooks/useSessions'
import { Host } from '../hooks/useHosts'

interface StatsData {
  cpu_percent?: number
  memory?: {
    total_mb: number
    used_mb: number
    percent: number
  }
  agent_panes?: number
}

interface StatusBarProps {
  sessionCount: number
  connected: boolean | null
  activeSession: Session | null
  waitingCount: number
  pushState: string
  version: string | null
  updateAvailable: boolean
  hosts: Host[]
  agentCount: number
  onHelp?: () => void
}

export function StatusBar({ sessionCount, connected, activeSession, waitingCount, pushState, version, updateAvailable, hosts, agentCount, onHelp }: StatusBarProps) {
  const [stats, setStats] = useState<StatsData>({})

  useEffect(() => {
    let active = true
    const poll = () => {
      fetch('/api/stats')
        .then(r => r.json())
        .then(data => {
          if (!active) return
          setStats({
            cpu_percent: data.system?.cpu_percent,
            memory: data.system?.memory,
            agent_panes: data.agent_panes,
          })
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const activeWindow = activeSession?.windows?.find(w => w.active)
  const paneCount = activeWindow?.panes?.length ?? 0

  const peersConnected = hosts.filter(h => !h.local && h.online).length
  const peersConfigured = hosts.filter(h => !h.local).length
  const hostCount = hosts.filter(h => h.online).length
  const totalAgents = stats.agent_panes ?? agentCount

  return (
    <footer className="flex items-center justify-between px-4 py-1 border-t border-border bg-card text-xs text-muted-foreground font-mono font-bold">
      <div className="flex items-center gap-4 overflow-x-auto">
        {peersConfigured > 0 && (
          <span className="hidden md:inline">PEERS: <span className={peersConnected === peersConfigured ? 'text-foreground' : 'text-warning'}>{peersConnected}/{peersConfigured}</span></span>
        )}
        {hosts.length > 1 && (
          <span className="hidden md:inline">HOSTS: <span className="text-foreground">{hostCount}</span></span>
        )}
        <span>SESSIONS: <span className="text-foreground">{sessionCount}</span></span>
        <span>AGENTS: <span className={totalAgents > 0 ? 'text-foreground' : ''}>{totalAgents}</span></span>
        {activeSession && (
          <span>SESSION: <span className="text-foreground">{activeSession.host ? `${activeSession.host_name || activeSession.host}/` : ''}{activeSession.name}</span></span>
        )}
        {activeWindow && (
          <span>WIN: <span className="text-foreground">{activeWindow.index}:{activeWindow.name}</span></span>
        )}
        {paneCount > 1 && (
          <span>PANES: <span className="text-foreground">{paneCount}</span></span>
        )}
        {waitingCount > 0 && (
          <span className="text-warning">WAITING: {waitingCount}</span>
        )}
      </div>
      <div className="flex items-center gap-4 overflow-x-auto">
        {stats.cpu_percent !== undefined && (
          <span className="hidden md:inline">CPU: <span className="text-foreground">{stats.cpu_percent}%</span></span>
        )}
        {stats.memory && (
          <span className="hidden md:inline">MEM: <span className="text-foreground">{stats.memory.percent}%</span></span>
        )}
        {pushState !== 'unsupported' && (
          <span className="hidden md:flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className={pushState === 'subscribed' ? 'text-primary' : pushState === 'denied' ? 'text-destructive' : ''}>
              {pushState === 'subscribed' ? 'PUSH' : pushState === 'denied' ? 'PUSH BLOCKED' : 'PUSH OFF'}
            </span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
            connected === true ? 'bg-primary' : connected === false ? 'bg-destructive animate-[pulse_1.5s_ease-in-out_infinite]' : 'bg-muted-foreground animate-[pulse_1.5s_ease-in-out_infinite]'
          }`} />
          <span className={connected === true ? 'text-primary' : connected === false ? 'text-destructive' : ''}>
            {connected === true ? 'CONNECTED' : connected === false ? 'DISCONNECTED' : 'CONNECTING'}
          </span>
        </span>
        {version && (
          <span className="hidden md:flex items-center gap-1">
            {updateAvailable ? (
              <button
                onClick={() => window.location.reload()}
                className="text-warning hover:text-foreground transition-colors"
                title="A new version is available — click to reload"
              >
                {version} (update available)
              </button>
            ) : (
              <span className="text-muted-foreground">{version}</span>
            )}
          </span>
        )}
        {onHelp && (
          <button
            onClick={onHelp}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Keyboard shortcuts (Ctrl+/)"
          >
            ?
          </button>
        )}
      </div>
    </footer>
  )
}
