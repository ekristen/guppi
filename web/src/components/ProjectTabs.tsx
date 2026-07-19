import { Session, sessionKey } from '../hooks/useSessions'
import { ToolEvent } from '../hooks/useToolEvents'
import { cn } from '../lib/utils'

interface ProjectTabsProps {
  sessions: Session[]
  events: ToolEvent[]
  activeProject: string | null
  onSelectProject: (project: string | null) => void
}

export function ProjectTabs({ sessions, events, activeProject, onSelectProject }: ProjectTabsProps) {
  // Aggregate per project: session count + actionable alert count
  // (waiting, error, or completed-but-not-seen).
  const projects = new Map<string, { sessions: number; alerts: number }>()
  for (const s of sessions) {
    const p = s.project || 'ungrouped'
    const entry = projects.get(p) || { sessions: 0, alerts: 0 }
    entry.sessions++
    const sk = sessionKey(s)
    entry.alerts += events.filter(e => {
      if ((e.host ? `${e.host}/${e.session}` : e.session) !== sk) return false
      return e.status === 'waiting' || e.status === 'error' || (e.status === 'completed' && !e.seen)
    }).length
    projects.set(p, entry)
  }

  // Sort: alpha asc, ungrouped last.
  const sorted = Array.from(projects.entries()).sort(([a], [b]) => {
    if (a === 'ungrouped') return 1
    if (b === 'ungrouped') return -1
    return a.localeCompare(b)
  })

  // If there's only ever going to be one project or none, don't render the strip.
  if (sorted.length <= 1) return null

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/50 px-2 h-9 shrink-0 font-mono text-xs">
      <button
        onClick={() => onSelectProject(null)}
        className={cn(
          'px-2.5 py-1 rounded transition-colors whitespace-nowrap',
          activeProject === null
            ? 'bg-primary/15 text-primary font-semibold'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        All
      </button>
      {sorted.map(([project, counts]) => (
        <button
          key={project}
          onClick={() => onSelectProject(project)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors whitespace-nowrap',
            activeProject === project
              ? 'bg-primary/15 text-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span>{project}</span>
          {counts.alerts > 0 && (
            <span className="px-1 py-0.5 rounded-full bg-warning/20 text-warning text-[9px] font-bold">
              {counts.alerts}
            </span>
          )}
          <span className="text-muted-foreground/50 text-[10px]">{counts.sessions}</span>
        </button>
      ))}
    </div>
  )
}
