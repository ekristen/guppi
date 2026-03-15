import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { Terminal } from './components/Terminal'
import { Overview } from './components/Overview'
import { QuickSwitcher } from './components/QuickSwitcher'
import { NewSessionModal } from './components/NewSessionModal'
import { TopBar } from './components/TopBar'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { HelpModal } from './components/HelpModal'
import { Login } from './components/Login'
import { Setup } from './components/Setup'
import { TrustCertificate } from './components/TrustCertificate'
import { useSessions, Session, sessionKey, parseSessionKey } from './hooks/useSessions'
import { useHosts } from './hooks/useHosts'
import { useToolEvents } from './hooks/useToolEvents'
import { useActivity } from './hooks/useActivity'
import { useNotifications } from './hooks/useNotifications'
import { useWebSocket } from './hooks/useWebSocket'
import { usePushNotifications } from './hooks/usePushNotifications'
import { usePreferencesProvider, usePreferences, PreferencesContext } from './hooks/usePreferences'
import { useAuth } from './hooks/useAuth'
import { applyTheme } from './theme'

type View = 'overview' | 'session' | 'settings' | 'setup'

function getViewFromPath(): { view: View; sessionKey: string | null } {
  if (window.location.pathname === '/settings') {
    return { view: 'settings', sessionKey: null }
  }
  if (window.location.pathname === '/setup') {
    return { view: 'setup', sessionKey: null }
  }
  // /session/<host>/<name> or /session/<name> (backward compat)
  const hostMatch = window.location.pathname.match(/^\/session\/([^/]+)\/(.+)$/)
  if (hostMatch) {
    const host = decodeURIComponent(hostMatch[1])
    const name = decodeURIComponent(hostMatch[2])
    return { view: 'session', sessionKey: `${host}/${name}` }
  }
  const match = window.location.pathname.match(/^\/session\/(.+)$/)
  if (match) {
    return { view: 'session', sessionKey: decodeURIComponent(match[1]) }
  }
  return { view: 'overview', sessionKey: null }
}

function AppInner({ onLogout }: { onLogout?: () => void }) {
  const { sessions, refresh } = useSessions()
  const { events: allToolEvents, handleEvent: handleToolEvent, getSessionEvents, sessionNeedsAttention, dismissEvent, dismissAll: dismissAllEvents } = useToolEvents()
  const { getSessionActivity, handleActivityEvent } = useActivity()
  const { pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications()
  const { processToolEvent } = useNotifications()
  const { hosts, refresh: refreshHosts } = useHosts()
  const [currentView, setCurrentView] = useState<View>(() => getViewFromPath().view)
  const [selectedSession, setSelectedSession] = useState<string | null>(() => getViewFromPath().sessionKey)
  const hasMultipleHosts = hosts.length > 1 || sessions.some(s => !!s.host)
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const loadedVersionRef = useRef<string | null>(null)
  const updateAvailable = loadedVersionRef.current !== null && serverVersion !== null && serverVersion !== loadedVersionRef.current
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('guppi:sidebar-collapsed') === 'true' } catch { return false }
  })
  const [terminalFullscreen, setTerminalFullscreen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingSessionRef = useRef<string | null>(null)
  const { prefs } = usePreferences()

  // Auto-lock: idle detection + optional background accelerator
  const lastActivityRef = useRef<number>(Date.now())
  useEffect(() => {
    if (!onLogout || !prefs.lock_timeout_minutes) return

    const idleMs = prefs.lock_timeout_minutes * 60 * 1000
    const bgMs = prefs.lock_background_faster && prefs.lock_background_minutes
      ? prefs.lock_background_minutes * 60 * 1000
      : idleMs

    // Track user activity
    const onActivity = () => { lastActivityRef.current = Date.now() }
    const events = ['keydown', 'click', 'scroll', 'touchstart', 'mousemove'] as const
    const opts: AddEventListenerOptions = { passive: true, capture: true }
    events.forEach(e => document.addEventListener(e, onActivity, opts))

    // Check idle on an interval
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      const timeout = document.hidden ? bgMs : idleMs
      if (elapsed >= timeout) {
        onLogout()
      }
    }, 30_000)

    // Also check immediately when returning from background
    const onVisibilityChange = () => {
      if (!document.hidden) {
        const elapsed = Date.now() - lastActivityRef.current
        if (elapsed >= bgMs) {
          onLogout()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      events.forEach(e => document.removeEventListener(e, onActivity, opts as EventListenerOptions))
      clearInterval(checkInterval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onLogout, prefs.lock_timeout_minutes, prefs.lock_background_faster, prefs.lock_background_minutes])

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('guppi:sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Sync URL -> state on popstate (back/forward)
  useEffect(() => {
    const onPopState = () => {
      const { view, sessionKey } = getViewFromPath()
      setCurrentView(view)
      setSelectedSession(sessionKey)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Navigate to a session or view (push history)
  // sessKey is either "name" (local) or "host/name" (remote)
  const navigateTo = useCallback((sessKey: string | null, view?: View) => {
    let path: string
    if (view === 'settings') {
      path = '/settings'
    } else if (view === 'setup') {
      path = '/setup'
    } else if (sessKey) {
      const { host, name } = parseSessionKey(sessKey)
      if (host) {
        path = `/session/${encodeURIComponent(host)}/${encodeURIComponent(name)}`
      } else {
        path = `/session/${encodeURIComponent(name)}`
      }
    } else {
      path = '/'
    }
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setSelectedSession(sessKey)
    setCurrentView(view || (sessKey ? 'session' : 'overview'))
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const shortcut = prefs.quick_switcher_shortcut || 'ctrl+k'
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // Quick switcher
      if (mod) {
        let match = false
        if (shortcut === 'ctrl+k' && e.key === 'k') match = true
        if (shortcut === 'ctrl+p' && e.key === 'p') match = true
        if (shortcut === 'ctrl+space' && e.key === ' ') match = true
        if (match) {
          e.preventDefault()
          setQuickSwitcherOpen(prev => !prev)
          return
        }
      }

      // Help: Cmd/Ctrl + ? or Cmd/Ctrl + / (Linux Ctrl+Shift+/ often doesn't produce '?')
      if (mod && (e.key === '?' || e.key === '/' || (e.shiftKey && e.code === 'Slash'))) {
        e.preventDefault()
        setHelpOpen(prev => !prev)
        return
      }

      // Overview: Cmd/Ctrl + O (also Cmd+H on desktop)
      if (mod && (e.key === 'o' || e.key === 'h') && !e.shiftKey) {
        e.preventDefault()
        navigateTo(null)
        return
      }

      // Toggle sidebar: Cmd/Ctrl + \
      if (mod && e.key === '\\') {
        e.preventDefault()
        setSidebarCollapsed(c => !c)
        return
      }

      // Settings: Cmd/Ctrl + ,
      if (mod && e.key === ',') {
        e.preventDefault()
        navigateTo(null, 'settings')
        return
      }

      // Lock / Sign out: Cmd/Ctrl + L
      if (mod && e.key === 'l' && !e.shiftKey && onLogout) {
        e.preventDefault()
        onLogout()
        return
      }

      // Jump to next alert: Cmd/Ctrl + J
      if (mod && e.key === 'j' && !e.shiftKey) {
        e.preventDefault()
        const pending = allToolEvents.filter(ev => ev.status === 'waiting' || ev.status === 'error')
        if (pending.length === 0) return
        const currentIdx = selectedSession
          ? pending.findIndex(ev => (ev.host ? `${ev.host}/${ev.session}` : ev.session) === selectedSession)
          : -1
        const next = pending[(currentIdx + 1) % pending.length]
        const sessKey = next.host ? `${next.host}/${next.session}` : next.session
        navigateTo(sessKey, 'session')
        if (next.window !== undefined) {
          const { host, name } = parseSessionKey(sessKey)
          fetch('/api/session/select-window', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: host || undefined, session: name, window: next.window, pane: next.pane || undefined }),
          }).catch(() => {})
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [prefs.quick_switcher_shortcut, navigateTo, onLogout, allToolEvents, selectedSession])

  // Listen for state events via WebSocket
  const onEvent = useCallback((evt: any) => {
    if (evt.type === 'welcome') {
      const v = evt.version || null
      if (!loadedVersionRef.current) {
        loadedVersionRef.current = v
      }
      setServerVersion(v)
      return
    }
    if (evt.type === 'tool-event') {
      handleToolEvent(evt)
      processToolEvent(evt)
      return
    }
    if (evt.type === 'activity') {
      handleActivityEvent(evt.snapshots || [])
      return
    }
    if (['session-added', 'session-removed', 'sessions-changed'].includes(evt.type)) {
      refresh()
    }
    if (['peer-connected', 'peer-disconnected'].includes(evt.type)) {
      refresh()
      refreshHosts()
    }
  }, [refresh, refreshHosts, handleToolEvent, processToolEvent, handleActivityEvent])

  const { connected } = useWebSocket('/ws/events', onEvent)

  // If selected session was removed, go back to overview
  // (don't bounce if we're waiting for a newly created session to appear)
  useEffect(() => {
    if (selectedSession && selectedSession === pendingSessionRef.current) return
    if (selectedSession && sessions.length > 0 && !sessions.find(s => sessionKey(s) === selectedSession)) {
      navigateTo(null)
    }
  }, [sessions, selectedSession, navigateTo])

  const handleSessionSelect = (session: Session) => {
    navigateTo(sessionKey(session))
  }

  const refocusTerminal = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = terminalContainerRef.current?.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null
      textarea?.focus()
    })
  }, [])

  const jumpToSession = useCallback(async (sessKey: string, windowIndex?: number, pane?: string) => {
    navigateTo(sessKey, 'session')
    if (windowIndex !== undefined) {
      const { host, name } = parseSessionKey(sessKey)
      try {
        await fetch('/api/session/select-window', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: host || undefined, session: name, window: windowIndex, pane: pane || undefined }),
        })
      } catch (err) {
        console.error('Failed to select window:', err)
      }
    }
    setTimeout(() => refocusTerminal(), 200)
  }, [navigateTo, refocusTerminal])

  const navigateToSettings = useCallback(() => {
    navigateTo(null, 'settings')
  }, [navigateTo])

  const closeQuickSwitcher = useCallback(() => {
    setQuickSwitcherOpen(false)
    if (selectedSession) refocusTerminal()
  }, [selectedSession, refocusTerminal])

  const handleQuickSwitch = useCallback(async (sessKey: string, windowIndex?: number) => {
    setQuickSwitcherOpen(false)
    navigateTo(sessKey)
    if (windowIndex !== undefined) {
      const { host, name } = parseSessionKey(sessKey)
      try {
        await fetch('/api/session/select-window', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: host || undefined, session: name, window: windowIndex }),
        })
      } catch (err) {
        console.error('Failed to select window:', err)
      }
    }
    // Refocus after navigation and window switch settle
    setTimeout(() => refocusTerminal(), 200)
  }, [navigateTo, refocusTerminal])

  const openNewSessionModal = useCallback(() => {
    setQuickSwitcherOpen(false)
    setNewSessionModalOpen(true)
  }, [])

  const handleCreateSession = useCallback(async (name: string, hostId?: string) => {
    setNewSessionModalOpen(false)
    try {
      const res = await fetch('/api/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, host: hostId || undefined }),
      })
      if (res.ok) {
        const sessKey = hostId ? `${hostId}/${name}` : name
        pendingSessionRef.current = sessKey
        navigateTo(sessKey)
        await refresh()
        pendingSessionRef.current = null
        setTimeout(() => refocusTerminal(), 300)
      }
    } catch (err) {
      console.error('Failed to create session:', err)
      pendingSessionRef.current = null
    }
  }, [navigateTo, refresh, refocusTerminal])

  const toggleFullscreen = useCallback(() => {
    setTerminalFullscreen(f => !f)
  }, [])

  // Dynamic document title
  useEffect(() => {
    if (currentView === 'session' && selectedSession) {
      const session = sessions.find(s => sessionKey(s) === selectedSession)
      const displayName = session ? session.name : parseSessionKey(selectedSession).name
      const activeWindow = session?.windows?.find(w => w.active)
      if (activeWindow) {
        document.title = `${displayName}:${activeWindow.index}:${activeWindow.name} — guppi`
      } else {
        document.title = `${displayName} — guppi`
      }
    } else if (currentView === 'settings') {
      document.title = 'settings — guppi'
    } else {
      document.title = 'guppi'
    }
  }, [currentView, selectedSession, sessions])

  // Exit fullscreen when navigating away from terminal
  useEffect(() => {
    if (currentView !== 'session') {
      setTerminalFullscreen(false)
    }
  }, [currentView])

  const showingTerminal = currentView === 'session' && !!selectedSession

  return (
    <div className="flex flex-col h-dvh w-screen bg-background text-foreground relative">
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {quickSwitcherOpen && (
        <QuickSwitcher
          sessions={sessions}
          waitingEvents={allToolEvents.filter(e => e.status === 'waiting')}
          onSelect={handleQuickSwitch}
          onOverview={() => { closeQuickSwitcher(); navigateTo(null) }}
          onCreateSession={openNewSessionModal}
          onClose={closeQuickSwitcher}
        />
      )}
      {newSessionModalOpen && (
        <NewSessionModal
          hosts={hosts}
          onCreateSession={handleCreateSession}
          onClose={() => setNewSessionModalOpen(false)}
        />
      )}
      {/* TopBar - full width */}
      {(!terminalFullscreen || !prefs.fullscreen_hide_alerts) && (
        <TopBar
          currentView={currentView}
          sidebarCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          onOverview={() => navigateTo(null)}
          onSettings={navigateToSettings}
          onNewSession={openNewSessionModal}
          events={allToolEvents}
          connected={connected}
          onJumpToSession={jumpToSession}
          onDismiss={dismissEvent}
          onDismissAll={dismissAllEvents}
        />
      )}
      {/* Middle: Sidebar + Content */}
      <div className="flex-1 flex overflow-hidden">
        {!terminalFullscreen && (
          <Sidebar
            sessions={sessions}
            selectedSession={selectedSession}
            collapsed={sidebarCollapsed}
            collapseMode={(prefs.sidebar.collapse_mode || 'small') as 'small' | 'hidden'}
            hasMultipleHosts={hasMultipleHosts}
            onSessionSelect={handleSessionSelect}
            onSessionRenamed={(oldKey, newKey) => {
              if (selectedSession === oldKey) navigateTo(newKey)
            }}
            getSessionEvents={getSessionEvents}
            sessionNeedsAttention={sessionNeedsAttention}
            getSessionActivity={getSessionActivity}
          />
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentView === 'setup' ? (
            <Setup onComplete={() => navigateTo(null)} />
          ) : currentView === 'settings' ? (
            <Settings pushState={pushState} onPushSubscribe={pushSubscribe} onPushUnsubscribe={pushUnsubscribe} onLogout={onLogout} />
          ) : selectedSession ? (
            <div ref={terminalContainerRef} className="flex-1 flex flex-col overflow-hidden">
              <Terminal
                sessionName={parseSessionKey(selectedSession).name}
                hostId={parseSessionKey(selectedSession).host || undefined}
                fullscreen={terminalFullscreen}
                onToggleFullscreen={toggleFullscreen}
              />
            </div>
          ) : (
            <Overview
              sessions={sessions}
              hosts={hosts}
              onSessionSelect={handleSessionSelect}
              getSessionEvents={getSessionEvents}
              getSessionActivity={getSessionActivity}
              pendingAlerts={allToolEvents.filter(e => e.status === 'waiting' || e.status === 'error')}
              onJumpToSession={jumpToSession}
              onDismissAlert={dismissEvent}
            />
          )}
        </div>
      </div>
      {/* StatusBar - full width */}
      <StatusBar
        sessionCount={sessions.length}
        connected={connected}
        activeSession={selectedSession ? sessions.find(s => sessionKey(s) === selectedSession) ?? null : null}
        waitingCount={allToolEvents.filter(e => e.status === 'waiting').length}
        pushState={pushState}
        version={serverVersion}
        updateAvailable={updateAvailable}
        hosts={hosts}
        agentCount={allToolEvents.filter(e => e.auto_detected || e.status === 'waiting' || e.status === 'error').length}
        onHelp={() => setHelpOpen(true)}
      />
    </div>
  )
}

export default function App() {
  const prefsProvider = usePreferencesProvider()
  const { loading, authRequired, needsSetup, authenticated, error: authError, setup, login, logout } = useAuth()
  const [showTrust, setShowTrust] = useState(() => window.location.pathname === '/trust')
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Re-fetch preferences after login (initial fetch may have gotten 401)
  useEffect(() => {
    if (authenticated) {
      prefsProvider.refetch()
    }
  }, [authenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply last-used theme immediately (before auth) so login page is themed
  useEffect(() => {
    try {
      const cached = localStorage.getItem('guppi:theme')
      const cachedCustom = localStorage.getItem('guppi:custom-theme')
      if (cached) {
        applyTheme(cached, cachedCustom ? JSON.parse(cachedCustom) : undefined)
      }
    } catch {}
  }, [])

  // Apply theme when preferences load or theme/customizations change, and cache for login page
  useEffect(() => {
    if (prefsProvider.loaded) {
      applyTheme(prefsProvider.prefs.theme, prefsProvider.prefs.custom_theme)
      try {
        localStorage.setItem('guppi:theme', prefsProvider.prefs.theme)
        localStorage.setItem('guppi:custom-theme', JSON.stringify(prefsProvider.prefs.custom_theme || {}))
      } catch {}
    }
  }, [prefsProvider.loaded, prefsProvider.prefs.theme, prefsProvider.prefs.custom_theme])

  if (loading) {
    return <div className="flex items-center justify-center h-dvh w-screen bg-background" />
  }

  if (showTrust || window.location.pathname === '/trust') {
    return <TrustCertificate onBack={() => { setShowTrust(false); window.history.pushState(null, '', '/') }} />
  }

  if (authRequired && needsSetup) {
    const handleSetup = async (password: string) => {
      const ok = await setup(password)
      if (ok) setShowOnboarding(true)
      return ok
    }
    return <Login mode="setup" error={authError} onSubmit={handleSetup} onTrustCert={() => { setShowTrust(true); window.history.pushState(null, '', '/trust') }} />
  }

  if (authRequired && !authenticated) {
    return <Login mode="login" error={authError} onSubmit={login} onTrustCert={() => { setShowTrust(true); window.history.pushState(null, '', '/trust') }} />
  }

  if (authenticated && showOnboarding) {
    return (
      <PreferencesContext.Provider value={prefsProvider}>
        <Setup fullPage onComplete={() => {
          setShowOnboarding(false)
          try { localStorage.setItem('guppi:setup-seen', 'true') } catch {}
        }} />
      </PreferencesContext.Provider>
    )
  }

  return (
    <PreferencesContext.Provider value={prefsProvider}>
      <AppInner onLogout={authRequired ? logout : undefined} />
    </PreferencesContext.Provider>
  )
}
