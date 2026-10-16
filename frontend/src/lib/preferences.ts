import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'comfortable'

export const THEME_KEY = 'ntb-theme'
export const DENSITY_KEY = 'ntb-density'

const storage = () => globalThis.localStorage as Storage | undefined

function readTheme(): Theme {
  const v = storage()?.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function readDensity(): Density {
  return storage()?.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact'
}

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Applies theme + density to <html> (class "dark", data-density) — DESIGN.md §3, §5. */
export function applyPreferences(theme: Theme, density: Density): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark()))
  root.dataset.density = density
}

interface PreferencesState {
  theme: Theme
  density: Density
  setTheme: (theme: Theme) => void
  setDensity: (density: Density) => void
}

/** UI preferences saved per browser (per-user server storage comes with the profile page). */
export const usePreferences = create<PreferencesState>((set, get) => ({
  theme: readTheme(),
  density: readDensity(),
  setTheme: (theme) => {
    storage()?.setItem(THEME_KEY, theme)
    applyPreferences(theme, get().density)
    set({ theme })
  },
  setDensity: (density) => {
    storage()?.setItem(DENSITY_KEY, density)
    applyPreferences(get().theme, density)
    set({ density })
  },
}))

/** Call once at startup: applies saved preferences and follows OS theme changes in "system" mode. */
export function initPreferences(): void {
  const { theme, density } = usePreferences.getState()
  applyPreferences(theme, density)
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    const s = usePreferences.getState()
    applyPreferences(s.theme, s.density)
  })
}
