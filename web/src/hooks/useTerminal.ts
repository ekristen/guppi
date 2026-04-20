import { useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon, type IClipboardProvider, type ClipboardSelectionType } from '@xterm/addon-clipboard'
import { usePreferences } from './usePreferences'
import { getXtermTheme } from '../theme'
import '@xterm/xterm/css/xterm.css'

// Monotonically increasing ID to track which connection is "current"
let nextConnId = 0

// Pending clipboard text to write on the next user interaction.
// Clipboard API requires user activation; OSC 52 and selection events arrive
// asynchronously, so we stash the text and flush it on the next mousedown/keydown.
let pendingClipboard: string | null = null

// Synchronous fallback using execCommand('copy') — works inside and outside
// user-gesture context in most browsers because the textarea selection counts
// as a copy-eligible action.
function execCommandCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch { /* ignored */ }
  document.body.removeChild(ta)
  return ok
}

// Try to write to clipboard immediately; on failure, use execCommand fallback;
// if that also fails, stash for deferred write on next user gesture.
function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text).catch(() => {
      if (!execCommandCopy(text)) {
        pendingClipboard = text
      }
    })
  }
  if (!execCommandCopy(text)) {
    pendingClipboard = text
  }
  return Promise.resolve()
}

// Flush any stashed clipboard text — call from a user gesture handler.
function flushPendingClipboard(): void {
  if (pendingClipboard !== null) {
    const text = pendingClipboard
    pendingClipboard = null
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        if (!execCommandCopy(text)) {
          pendingClipboard = text
        }
      })
    } else if (!execCommandCopy(text)) {
      pendingClipboard = text
    }
  }
}

// Request clipboard-write permission so future writes don't require user activation.
// Chromium grants this persistently once allowed; Firefox/Safari ignore it (harmless).
function requestClipboardPermission(): void {
  navigator.permissions?.query({ name: 'clipboard-write' as PermissionName }).catch(() => {})
}

// Custom clipboard provider that uses the fallback copy for OSC 52 writes
const clipboardProvider: IClipboardProvider = {
  readText(selection: ClipboardSelectionType): Promise<string> {
    if (selection !== 'c') return Promise.resolve('')
    return navigator.clipboard?.readText?.() ?? Promise.resolve('')
  },
  writeText(selection: ClipboardSelectionType, text: string): Promise<void> {
    if (selection !== 'c') return Promise.resolve()
    return copyToClipboard(text)
  },
}

const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function sendPastedImage(ws: WebSocket, file: File, fallbackType: string): Promise<void> {
  if (file.size > MAX_PASTED_IMAGE_BYTES) {
    console.warn(`Pasted image exceeds ${MAX_PASTED_IMAGE_BYTES} byte limit`)
    return
  }

  const buffer = await file.arrayBuffer()
  ws.send(JSON.stringify({
    type: 'paste-image',
    data: bytesToBase64(new Uint8Array(buffer)),
    mime: file.type || fallbackType,
    filename: file.name,
  }))
}

export function useTerminal(sessionName: string, hostId?: string) {
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const listenerCleanupRef = useRef<(() => void) | null>(null)
  const reconnectTimer = useRef<number | undefined>(undefined)
  const activeConnId = useRef(0)
  const [termConnected, setTermConnected] = useState(false)
  const { prefs } = usePreferences()

  const cleanupWs = useCallback(() => {
    if (wsRef.current) {
      // Nullify handlers BEFORE closing to prevent ghost reconnects
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback((container: HTMLElement) => {
    // Invalidate any previous connection's reconnect attempts
    const connId = ++nextConnId
    activeConnId.current = connId

    // Clean up any existing terminal and WS
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = undefined
    }
    cleanupWs()
    if (termRef.current) {
      listenerCleanupRef.current?.()
      listenerCleanupRef.current = null
      termRef.current.dispose()
    }

    containerRef.current = container

    const xtermTheme = getXtermTheme(prefs.theme)
    const fontFamily = `'${prefs.terminal.font_family}', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace`

    // Create terminal with theme from preferences
    const term = new Terminal({
      theme: xtermTheme,
      fontSize: prefs.terminal.font_size,
      fontFamily,
      cursorBlink: true,
      scrollback: prefs.terminal.scrollback,
      allowProposedApi: true,
      rightClickSelectsWord: true,
      macOptionClickForcesSelection: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(new ClipboardAddon(undefined, clipboardProvider))

    termRef.current = term
    fitAddonRef.current = fitAddon
    // DEBUG: expose for diagnostics (remove after debugging)
    ;(window as any).__term = term

    term.open(container)
    const helperTextarea = container.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null

    // Request clipboard-write permission early so OSC 52 writes may work directly
    requestClipboardPermission()

    // Cmd/Ctrl+C: copy selection to clipboard if text is selected,
    // otherwise let it pass through as SIGINT.
    // Also flush any pending clipboard on every keydown (user gesture context).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') {
        flushPendingClipboard()
      }
      // Don't let xterm process global app shortcuts (quick switcher, overview, etc.)
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey)) {
        const key = e.key.toLowerCase()
        if (!e.shiftKey && (key === 'k' || key === 'p' || key === 'h' ||
            key === 'l' || key === ',' || key === '\\' || key === ' ')) {
          return false
        }
        if (e.shiftKey && (key === '/' || key === '?')) {
          return false
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && e.type === 'keydown') {
        const selection = term.getSelection()
        if (selection) {
          // Direct user gesture — clipboard write succeeds without stashing
          navigator.clipboard?.writeText(selection)
          term.clearSelection()
          return false // prevent sending to terminal
        }
        // Explicitly send SIGINT (0x03) — iPad/tablets may not translate
        // Ctrl+C correctly, causing it to act as Enter instead
        const currentWs = wsRef.current
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
          currentWs.send(new Uint8Array([0x03]))
        }
        return false
      }
      return true
    })

    // Auto-copy to clipboard on selection (like iTerm2 / most terminal emulators)
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) {
        copyToClipboard(selection)
      }
    })

    // Flush deferred clipboard writes on mouse interaction (capture phase
    // to intercept before xterm.js can stopPropagation)
    const onMouseDown = () => flushPendingClipboard()
    const onKeyDown = () => flushPendingClipboard()
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const imageItem = items.find(item => item.type.startsWith('image/'))
      if (!imageItem) return

      const file = imageItem.getAsFile()
      const currentWs = wsRef.current
      if (!file || !currentWs || currentWs.readyState !== WebSocket.OPEN) return

      e.preventDefault()

      sendPastedImage(currentWs, file, imageItem.type)
        .catch((err) => {
          console.error('Failed to read pasted image:', err)
        })
    }
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    container.addEventListener('mousedown', onMouseDown, true)
    container.addEventListener('keydown', onKeyDown, true)
    helperTextarea?.addEventListener('paste', onPaste)

    // Suppress browser's native context menu so right-click passes through to tmux
    container.addEventListener('contextmenu', onContextMenu)
    listenerCleanupRef.current = () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      container.removeEventListener('keydown', onKeyDown, true)
      helperTextarea?.removeEventListener('paste', onPaste)
      container.removeEventListener('contextmenu', onContextMenu)
    }

    // Fit terminal to container — retry a few times to handle layout settling
    const doFit = () => {
      try {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          fitAddon.fit()
        }
      } catch {}
    }
    doFit()
    requestAnimationFrame(doFit)
    setTimeout(doFit, 100)
    setTimeout(doFit, 300)

    // Get initial dimensions
    const cols = term.cols || 80
    const rows = term.rows || 24

    // Connect WebSocket for this session
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hostParam = hostId ? `&host=${encodeURIComponent(hostId)}` : ''
    const wsUrl = `${protocol}//${window.location.host}/ws/session?name=${encodeURIComponent(sessionName)}&cols=${cols}&rows=${rows}${hostParam}`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      // Stale connection — a newer connect() was called
      if (activeConnId.current !== connId) {
        ws.close()
        return
      }
      setTermConnected(true)
    }

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(evt.data))
      } else {
        term.write(evt.data)
      }
    }

    ws.onclose = () => {
      // Only handle if this is still the active connection
      if (activeConnId.current !== connId) return
      // Don't flash the disconnect overlay if the page is just hidden
      if (!document.hidden) {
        setTermConnected(false)
      }
      // If hidden (e.g. iPad app switch), defer reconnect until page is visible again
      if (document.hidden) {
        const onVisible = () => {
          if (activeConnId.current !== connId) return
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('pageshow', onVisible)
          if (containerRef.current && activeConnId.current === connId) {
            connect(containerRef.current)
          }
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('pageshow', onVisible)
      } else if (containerRef.current) {
        reconnectTimer.current = window.setTimeout(() => {
          if (containerRef.current && activeConnId.current === connId) {
            connect(containerRef.current)
          }
        }, 2000)
      }
    }

    ws.onerror = (err) => {
      console.error(`Terminal WS error: session ${sessionName}`, err)
    }

    // Forward keystrokes as binary messages
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = new TextEncoder()
        ws.send(encoder.encode(data))
      }
    })

    // Send resize events as JSON text messages
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })
  }, [sessionName, hostId, cleanupWs, prefs.theme, prefs.terminal.font_size, prefs.terminal.font_family, prefs.terminal.scrollback])

  const disconnect = useCallback(() => {
    // Invalidate any active connection
    activeConnId.current = ++nextConnId
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = undefined
    }
    cleanupWs()
    if (termRef.current) {
      listenerCleanupRef.current?.()
      listenerCleanupRef.current = null
      termRef.current.dispose()
      termRef.current = null
    }
    containerRef.current = null
  }, [cleanupWs])

  const fit = useCallback(() => {
    if (fitAddonRef.current && containerRef.current) {
      try {
        if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
          fitAddonRef.current.fit()
        }
      } catch {}
    }
  }, [])

  const focus = useCallback(() => {
    termRef.current?.focus()
  }, [])

  return { termRef, connect, disconnect, fit, focus, termConnected }
}
