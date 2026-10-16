import { produce } from 'immer'
import { create } from 'zustand'
import type { DocCommand } from './commands'
import {
  changesOf,
  docFromDetail,
  type DiagramDetail,
  type DiagramMeta,
  type DiagramSave,
  type DocState,
} from './types'

// Diagram editor store (P1-13): Zustand + Immer, command based, undo / redo ≥ 100 steps (SRS §6.1). Saving
// replaces the document with the server's answer and starts a fresh history (temp ids become real ids).

export const DOC_UNDO_LIMIT = 200

interface PastEntry {
  doc: DocState
  mergeKey?: string
}

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'conflict' | 'error'

export interface DocStore {
  meta: DiagramMeta | null
  doc: DocState | null
  past: PastEntry[]
  future: DocState[]
  status: SaveStatus
  error: string | null
  load(detail: DiagramDetail): void
  /** Restore a draft over the loaded diagram (same document shape). */
  restore(doc: DocState): void
  dispatch(command: DocCommand): void
  undo(): void
  redo(): void
  saveRequest(): DiagramSave | null
  setStatus(status: SaveStatus, error?: string | null): void
  saved(detail: DiagramDetail): void
}

export function createDocStore() {
  return create<DocStore>()((set, get) => ({
    meta: null,
    doc: null,
    past: [],
    future: [],
    status: 'clean',
    error: null,
    load: (detail) =>
      set({
        meta: detail.diagram,
        doc: docFromDetail(detail),
        past: [],
        future: [],
        status: 'clean',
        error: null,
      }),
    restore: (doc) => set({ doc, past: [], future: [], status: 'dirty', error: null }),
    dispatch: (command) => {
      const { doc, past, status } = get()
      if (!doc) return
      const next = produce(doc, (draft) => command.apply(draft))
      if (next === doc) return // no-op command
      const top = past.at(-1)
      const merged = command.mergeKey !== undefined && top?.mergeKey === command.mergeKey
      set({
        doc: next,
        past: merged ? past : [...past, { doc, mergeKey: command.mergeKey }].slice(-DOC_UNDO_LIMIT),
        future: [],
        status: status === 'conflict' ? 'conflict' : 'dirty',
      })
    },
    undo: () => {
      const { doc, past, future } = get()
      const prev = past.at(-1)
      if (!doc || !prev) return
      set({ doc: prev.doc, past: past.slice(0, -1), future: [doc, ...future], status: 'dirty' })
    },
    redo: () => {
      const { doc, past, future } = get()
      const [next, ...rest] = future
      if (!doc || !next) return
      set({
        doc: next,
        past: [...past, { doc }].slice(-DOC_UNDO_LIMIT),
        future: rest,
        status: 'dirty',
      })
    },
    saveRequest: () => {
      const { doc, meta } = get()
      if (!doc || !meta) return null
      return { version: meta.version, view: doc.view, changes: changesOf(doc) }
    },
    setStatus: (status, error = null) => set({ status, error }),
    saved: (detail) =>
      set({
        meta: detail.diagram,
        doc: docFromDetail(detail),
        past: [],
        future: [],
        status: 'clean',
        error: null,
      }),
  }))
}

export type DocStoreApi = ReturnType<typeof createDocStore>
