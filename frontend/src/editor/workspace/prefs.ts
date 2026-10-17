import { useEffect, useState } from 'react'
import { GRID_SIZES, type GridSize } from './flow'

// Canvas preferences kept per browser (like the form-guide toggle): grid, snapping, minimap, first-run tips, library.

export interface EditorPrefs {
  snap: boolean
  grid: GridSize
  minimap: boolean
  tips: boolean
  library: boolean
  /** Property panel on the right (P1-18). */
  panel: boolean
}

const KEY = 'ntb-editor-prefs-v1'
const DEFAULTS: EditorPrefs = {
  snap: true,
  grid: 20,
  minimap: true,
  tips: true,
  library: true,
  panel: true,
}

export function readPrefs(): EditorPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<EditorPrefs>
    return {
      snap: typeof raw.snap === 'boolean' ? raw.snap : DEFAULTS.snap,
      grid: GRID_SIZES.includes(raw.grid as GridSize) ? (raw.grid as GridSize) : DEFAULTS.grid,
      minimap: typeof raw.minimap === 'boolean' ? raw.minimap : DEFAULTS.minimap,
      tips: typeof raw.tips === 'boolean' ? raw.tips : DEFAULTS.tips,
      library: typeof raw.library === 'boolean' ? raw.library : DEFAULTS.library,
      panel: typeof raw.panel === 'boolean' ? raw.panel : DEFAULTS.panel,
    }
  } catch {
    return DEFAULTS
  }
}

export function useEditorPrefs() {
  const [prefs, setPrefs] = useState(readPrefs)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // storage full or blocked: preferences just do not persist
    }
  }, [prefs])
  const update = (patch: Partial<EditorPrefs>) => setPrefs((p) => ({ ...p, ...patch }))
  return [prefs, update] as const
}
