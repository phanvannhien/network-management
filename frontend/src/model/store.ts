import { produce } from 'immer'
import { create } from 'zustand'
import type { Command } from './commands'
import { emptyData, type NtbData } from './types'

export const UNDO_LIMIT = 200 // SRS §3 requires ≥ 100

interface PastEntry {
  data: NtbData
  mergeKey?: string
}

export interface AppStore {
  data: NtbData
  /** Selected object ids (devices, links, …). UI state — not undoable. */
  selection: string[]
  /** Copied device ids (Ctrl+C). UI state — not undoable. */
  clipboard: string[]
  past: PastEntry[]
  future: NtbData[]
  dispatch(command: Command): void
  undo(): void
  redo(): void
  setSelection(ids: string[]): void
  setClipboard(ids: string[]): void
}

export type AppStoreApi = ReturnType<typeof createAppStore>

export function createAppStore() {
  return create<AppStore>()((set, get) => ({
    data: emptyData(),
    selection: [],
    clipboard: [],
    past: [],
    future: [],

    dispatch: (command) => {
      const { data, past } = get()
      const next = produce(data, (draft) => command.apply(draft))
      const top = past.at(-1)
      const merged = command.mergeKey !== undefined && top?.mergeKey === command.mergeKey
      set({
        data: next,
        past: merged ? past : [...past, { data, mergeKey: command.mergeKey }].slice(-UNDO_LIMIT),
        future: [],
      })
    },

    undo: () => {
      const { data, past, future } = get()
      const entry = past.at(-1)
      if (!entry) return
      set({
        data: entry.data,
        past: past.slice(0, -1),
        future: [data, ...future].slice(0, UNDO_LIMIT),
      })
    },

    redo: () => {
      const { data, future } = get()
      const next = future[0]
      if (!next) return
      set({
        data: next,
        past: [...get().past, { data }].slice(-UNDO_LIMIT),
        future: future.slice(1),
      })
    },

    setSelection: (ids) => set({ selection: ids }),
    setClipboard: (ids) => set({ clipboard: ids }),
  }))
}

/** Default app-wide store instance. */
export const useAppStore = createAppStore()
