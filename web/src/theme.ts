export const toolColors: Record<string, string> = {
    claude: '#c4a0ff',
    codex: '#66e088',
    copilot: '#66b3ff',
    opencode: '#bc8cff',
}

export const statusConfig: Record<string, { color: string; label: string; icon?: string; bg?: string }> = {
    active: { color: 'var(--success)', label: 'Running', bg: 'color-mix(in oklch, var(--success) 8%, transparent)' },
    waiting: { color: 'var(--warning)', label: 'Waiting', icon: '●', bg: 'color-mix(in oklch, var(--warning) 8%, transparent)' },
    error: { color: 'var(--destructive)', label: 'Error', icon: '!', bg: 'color-mix(in oklch, var(--destructive) 8%, transparent)' },
    completed: { color: 'var(--success)', label: 'Completed', icon: '✓', bg: 'color-mix(in oklch, var(--success) 8%, transparent)' },
    'completed-unseen': { color: 'var(--success)', label: 'DONE', icon: '✓', bg: 'color-mix(in oklch, var(--success) 12%, transparent)' },
}

export interface ThemePreset {
    name: string
    label: string
    cssVars: Record<string, string>
    xterm: {
        background: string
        foreground: string
        cursor: string
        cursorAccent: string
        selectionBackground: string
        black: string
        red: string
        green: string
        yellow: string
        blue: string
        magenta: string
        cyan: string
        white: string
        brightBlack: string
        brightRed: string
        brightGreen: string
        brightYellow: string
        brightBlue: string
        brightMagenta: string
        brightCyan: string
        brightWhite: string
    }
}

export const themePresets: Record<string, ThemePreset> = {
    'retro-blue': {
        name: 'retro-blue',
        label: 'Retro CRT Blue',
        cssVars: {
            '--background': 'oklch(0.08 0.02 250)',
            '--foreground': 'oklch(0.78 0.12 230)',
            '--card': 'oklch(0.1 0.02 250)',
            '--card-foreground': 'oklch(0.78 0.12 230)',
            '--popover': 'oklch(0.1 0.02 250)',
            '--popover-foreground': 'oklch(0.78 0.12 230)',
            '--primary': 'oklch(0.72 0.15 230)',
            '--primary-foreground': 'oklch(0.08 0.02 250)',
            '--secondary': 'oklch(0.15 0.03 250)',
            '--secondary-foreground': 'oklch(0.68 0.1 230)',
            '--muted': 'oklch(0.12 0.02 250)',
            '--muted-foreground': 'oklch(0.55 0.08 230)',
            '--accent': 'oklch(0.7 0.15 200)',
            '--accent-foreground': 'oklch(0.08 0.02 250)',
            '--destructive': 'oklch(0.55 0.2 25)',
            '--destructive-foreground': 'oklch(0.95 0 0)',
            '--border': 'oklch(0.28 0.08 230)',
            '--input': 'oklch(0.12 0.02 250)',
            '--ring': 'oklch(0.72 0.15 230)',
            '--success': 'oklch(0.65 0.15 145)',
            '--warning': 'oklch(0.65 0.15 80)',
            '--sidebar': 'oklch(0.06 0.02 250)',
            '--sidebar-foreground': 'oklch(0.78 0.12 230)',
            '--sidebar-primary': 'oklch(0.72 0.15 230)',
            '--sidebar-primary-foreground': 'oklch(0.08 0.02 250)',
            '--sidebar-accent': 'oklch(0.15 0.03 250)',
            '--sidebar-accent-foreground': 'oklch(0.78 0.12 230)',
            '--sidebar-border': 'oklch(0.28 0.08 230)',
            '--sidebar-ring': 'oklch(0.72 0.15 230)',
            '--chart-primary': 'oklch(0.72 0.12 230)',
            '--chart-secondary': 'oklch(0.72 0.12 300)',
        },
        xterm: {
            background: '#0a0a1a',
            foreground: '#66b3ff',
            cursor: '#66b3ff',
            cursorAccent: '#0a0a1a',
            selectionBackground: 'rgba(102, 179, 255, 0.25)',
            black: '#1a1a3a',
            red: '#ff7b72',
            green: '#66e088',
            yellow: '#e6c866',
            blue: '#66b3ff',
            magenta: '#c4a0ff',
            cyan: '#66d9e8',
            white: '#b8c4d0',
            brightBlack: '#3a3a5a',
            brightRed: '#ffa198',
            brightGreen: '#7ee8a0',
            brightYellow: '#f0d880',
            brightBlue: '#80c4ff',
            brightMagenta: '#d4b8ff',
            brightCyan: '#80e8f0',
            brightWhite: '#d0dce8',
        },
    },
    'dark': {
        name: 'dark',
        label: 'Dark',
        cssVars: {
            '--background': 'oklch(0.1 0 0)',
            '--foreground': 'oklch(0.85 0 0)',
            '--card': 'oklch(0.13 0 0)',
            '--card-foreground': 'oklch(0.85 0 0)',
            '--popover': 'oklch(0.13 0 0)',
            '--popover-foreground': 'oklch(0.85 0 0)',
            '--primary': 'oklch(0.7 0.1 210)',
            '--primary-foreground': 'oklch(0.1 0 0)',
            '--secondary': 'oklch(0.18 0 0)',
            '--secondary-foreground': 'oklch(0.7 0 0)',
            '--muted': 'oklch(0.15 0 0)',
            '--muted-foreground': 'oklch(0.55 0 0)',
            '--accent': 'oklch(0.65 0.1 210)',
            '--accent-foreground': 'oklch(0.1 0 0)',
            '--destructive': 'oklch(0.55 0.2 25)',
            '--destructive-foreground': 'oklch(0.95 0 0)',
            '--border': 'oklch(0.25 0 0)',
            '--input': 'oklch(0.15 0 0)',
            '--ring': 'oklch(0.7 0.1 210)',
            '--success': 'oklch(0.65 0.15 145)',
            '--warning': 'oklch(0.65 0.15 80)',
            '--sidebar': 'oklch(0.08 0 0)',
            '--sidebar-foreground': 'oklch(0.85 0 0)',
            '--sidebar-primary': 'oklch(0.7 0.1 210)',
            '--sidebar-primary-foreground': 'oklch(0.1 0 0)',
            '--sidebar-accent': 'oklch(0.18 0 0)',
            '--sidebar-accent-foreground': 'oklch(0.85 0 0)',
            '--sidebar-border': 'oklch(0.25 0 0)',
            '--sidebar-ring': 'oklch(0.7 0.1 210)',
            '--chart-primary': 'oklch(0.65 0.1 210)',
            '--chart-secondary': 'oklch(0.65 0.1 310)',
        },
        xterm: {
            background: '#1a1a1a',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            cursorAccent: '#1a1a1a',
            selectionBackground: 'rgba(212, 212, 212, 0.2)',
            black: '#1a1a1a',
            red: '#f44747',
            green: '#6a9955',
            yellow: '#d7ba7d',
            blue: '#569cd6',
            magenta: '#c586c0',
            cyan: '#4ec9b0',
            white: '#d4d4d4',
            brightBlack: '#808080',
            brightRed: '#f44747',
            brightGreen: '#6a9955',
            brightYellow: '#d7ba7d',
            brightBlue: '#569cd6',
            brightMagenta: '#c586c0',
            brightCyan: '#4ec9b0',
            brightWhite: '#e5e5e5',
        },
    },
    'light': {
        name: 'light',
        label: 'Light',
        cssVars: {
            '--background': 'oklch(0.97 0 0)',
            '--foreground': 'oklch(0.2 0 0)',
            '--card': 'oklch(1 0 0)',
            '--card-foreground': 'oklch(0.2 0 0)',
            '--popover': 'oklch(1 0 0)',
            '--popover-foreground': 'oklch(0.2 0 0)',
            '--primary': 'oklch(0.45 0.12 250)',
            '--primary-foreground': 'oklch(0.98 0 0)',
            '--secondary': 'oklch(0.92 0 0)',
            '--secondary-foreground': 'oklch(0.35 0 0)',
            '--muted': 'oklch(0.94 0 0)',
            '--muted-foreground': 'oklch(0.5 0 0)',
            '--accent': 'oklch(0.5 0.12 250)',
            '--accent-foreground': 'oklch(0.98 0 0)',
            '--destructive': 'oklch(0.5 0.2 25)',
            '--destructive-foreground': 'oklch(0.98 0 0)',
            '--border': 'oklch(0.85 0 0)',
            '--input': 'oklch(0.94 0 0)',
            '--ring': 'oklch(0.45 0.12 250)',
            '--success': 'oklch(0.5 0.15 145)',
            '--warning': 'oklch(0.55 0.15 80)',
            '--sidebar': 'oklch(0.95 0 0)',
            '--sidebar-foreground': 'oklch(0.2 0 0)',
            '--sidebar-primary': 'oklch(0.45 0.12 250)',
            '--sidebar-primary-foreground': 'oklch(0.98 0 0)',
            '--sidebar-accent': 'oklch(0.9 0 0)',
            '--sidebar-accent-foreground': 'oklch(0.2 0 0)',
            '--sidebar-border': 'oklch(0.85 0 0)',
            '--sidebar-ring': 'oklch(0.45 0.12 250)',
            '--chart-primary': 'oklch(0.5 0.12 250)',
            '--chart-secondary': 'oklch(0.5 0.12 310)',
        },
        xterm: {
            background: '#ffffff',
            foreground: '#383a42',
            cursor: '#383a42',
            cursorAccent: '#ffffff',
            selectionBackground: 'rgba(56, 58, 66, 0.15)',
            black: '#383a42',
            red: '#e45649',
            green: '#50a14f',
            yellow: '#c18401',
            blue: '#4078f2',
            magenta: '#a626a4',
            cyan: '#0184bc',
            white: '#fafafa',
            brightBlack: '#a0a1a7',
            brightRed: '#e45649',
            brightGreen: '#50a14f',
            brightYellow: '#c18401',
            brightBlue: '#4078f2',
            brightMagenta: '#a626a4',
            brightCyan: '#0184bc',
            brightWhite: '#ffffff',
        },
    },
    'green-phosphor': {
        name: 'green-phosphor',
        label: 'Green Phosphor',
        cssVars: {
            '--background': 'oklch(0.08 0.02 140)',
            '--foreground': 'oklch(0.75 0.15 145)',
            '--card': 'oklch(0.1 0.02 140)',
            '--card-foreground': 'oklch(0.75 0.15 145)',
            '--popover': 'oklch(0.1 0.02 140)',
            '--popover-foreground': 'oklch(0.75 0.15 145)',
            '--primary': 'oklch(0.7 0.18 145)',
            '--primary-foreground': 'oklch(0.08 0.02 140)',
            '--secondary': 'oklch(0.15 0.03 140)',
            '--secondary-foreground': 'oklch(0.65 0.12 145)',
            '--muted': 'oklch(0.12 0.02 140)',
            '--muted-foreground': 'oklch(0.5 0.08 145)',
            '--accent': 'oklch(0.65 0.15 145)',
            '--accent-foreground': 'oklch(0.08 0.02 140)',
            '--destructive': 'oklch(0.55 0.2 25)',
            '--destructive-foreground': 'oklch(0.95 0 0)',
            '--border': 'oklch(0.25 0.06 145)',
            '--input': 'oklch(0.12 0.02 140)',
            '--ring': 'oklch(0.7 0.18 145)',
            '--success': 'oklch(0.65 0.15 145)',
            '--warning': 'oklch(0.65 0.15 80)',
            '--sidebar': 'oklch(0.06 0.02 140)',
            '--sidebar-foreground': 'oklch(0.75 0.15 145)',
            '--sidebar-primary': 'oklch(0.7 0.18 145)',
            '--sidebar-primary-foreground': 'oklch(0.08 0.02 140)',
            '--sidebar-accent': 'oklch(0.15 0.03 140)',
            '--sidebar-accent-foreground': 'oklch(0.75 0.15 145)',
            '--sidebar-border': 'oklch(0.25 0.06 145)',
            '--sidebar-ring': 'oklch(0.7 0.18 145)',
            '--chart-primary': 'oklch(0.7 0.18 145)',
            '--chart-secondary': 'oklch(0.65 0.15 200)',
        },
        xterm: {
            background: '#0a1a0a',
            foreground: '#33ff33',
            cursor: '#33ff33',
            cursorAccent: '#0a1a0a',
            selectionBackground: 'rgba(51, 255, 51, 0.2)',
            black: '#0a1a0a',
            red: '#ff5555',
            green: '#33ff33',
            yellow: '#ffff55',
            blue: '#55aaff',
            magenta: '#ff55ff',
            cyan: '#55ffff',
            white: '#aaffaa',
            brightBlack: '#225522',
            brightRed: '#ff8888',
            brightGreen: '#66ff66',
            brightYellow: '#ffff88',
            brightBlue: '#88ccff',
            brightMagenta: '#ff88ff',
            brightCyan: '#88ffff',
            brightWhite: '#ccffcc',
        },
    },
    'midnight': {
        name: 'midnight',
        label: 'Midnight',
        cssVars: {
            // Core
            '--background': 'oklch(0.145 0 0)',            // #0a0a0a
            '--foreground': 'oklch(0.922 0 0)',            // #e5e5e5
            '--card': 'oklch(0.205 0 0)',                  // #1a1a1a
            '--card-foreground': 'oklch(0.922 0 0)',       // #e5e5e5
            '--popover': 'oklch(0.205 0 0)',               // #1a1a1a
            '--popover-foreground': 'oklch(0.922 0 0)',    // #e5e5e5
            '--primary': 'oklch(0.623 0.214 259)',         // #3b82f6
            '--primary-foreground': 'oklch(0.145 0 0)',    // #0a0a0a
            '--secondary': 'oklch(0.250 0 0)',             // #262626
            '--secondary-foreground': 'oklch(0.708 0 0)',  // #a3a3a3
            '--muted': 'oklch(0.195 0 0)',                 // #171717
            '--muted-foreground': 'oklch(0.556 0 0)',      // #737373
            '--accent': 'oklch(0.685 0.143 175)',          // #14b8a6
            '--accent-foreground': 'oklch(0.145 0 0)',     // #0a0a0a
            '--destructive': 'oklch(0.637 0.237 25)',      // #ef4444
            '--destructive-foreground': 'oklch(0.985 0 0)', // #fafafa
            '--border': 'oklch(0.265 0 0)',                // #2a2a2a
            '--input': 'oklch(0.195 0 0)',                 // #171717
            '--ring': 'oklch(0.623 0.214 259)',            // #3b82f6
            '--success': 'oklch(0.685 0.143 175)',         // #14b8a6
            '--warning': 'oklch(0.768 0.185 70)',          // #f59e0b

            // Chart
            '--chart-primary': 'oklch(0.623 0.214 259)',   // #3b82f6
            '--chart-secondary': 'oklch(0.685 0.143 175)', // #14b8a6

            // Sidebar
            '--sidebar': 'oklch(0.145 0 0)',               // #0a0a0a
            '--sidebar-foreground': 'oklch(0.922 0 0)',    // #e5e5e5
            '--sidebar-primary': 'oklch(0.623 0.214 259)', // #3b82f6
            '--sidebar-primary-foreground': 'oklch(0.145 0 0)', // #0a0a0a
            '--sidebar-accent': 'oklch(0.250 0 0)',        // #262626
            '--sidebar-accent-foreground': 'oklch(0.922 0 0)', // #e5e5e5
            '--sidebar-border': 'oklch(0.265 0 0)',        // #2a2a2a
            '--sidebar-ring': 'oklch(0.623 0.214 259)',    // #3b82f6
        },
        xterm: {
            background: '#0a0a0a',
            foreground: '#e5e5e5',
            cursor: '#3b82f6',
            cursorAccent: '#0a0a0a',
            selectionBackground: 'rgba(59, 130, 246, 0.3)',
            black: '#171717',
            red: '#ef4444',
            green: '#14b8a6',
            yellow: '#f59e0b',
            blue: '#3b82f6',
            magenta: '#a855f7',
            cyan: '#22d3ee',
            white: '#e5e5e5',
            brightBlack: '#737373',
            brightRed: '#f87171',
            brightGreen: '#2dd4bf',
            brightYellow: '#fbbf24',
            brightBlue: '#60a5fa',
            brightMagenta: '#c084fc',
            brightCyan: '#67e8f9',
            brightWhite: '#fafafa',
        },
    }
}

export function applyTheme(themeName: string, customTheme?: Record<string, string>) {
    const theme = themePresets[themeName] || themePresets['retro-blue']
    const root = document.documentElement
    for (const [key, value] of Object.entries(theme.cssVars)) {
        root.style.setProperty(key, value)
    }
    // Apply custom overrides on top of preset
    if (customTheme) {
        for (const [key, value] of Object.entries(customTheme)) {
            if (value) root.style.setProperty(key, value)
        }
    }
}

export function getXtermTheme(themeName: string) {
    const theme = themePresets[themeName] || themePresets['retro-blue']
    return theme.xterm
}
