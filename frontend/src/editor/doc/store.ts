import { produce } from 'immer'
import { create } from 'zustand'
import type { Problem, Severity } from '../checks/types'
import { SEVERITY_ORDER } from '../checks/types'
import type { DocCommand } from './commands'
import {
  ANN,
  changesOf,
  docFromDetail,
  type DiagramDetail,
  type DiagramMeta,
  type DiagramSave,
  type DiagramViewport,
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
export type Lens = 'physical' | 'l2'

export interface DocStore {
  meta: DiagramMeta | null
  doc: DocState | null
  past: PastEntry[]
  future: DocState[]
  status: SaveStatus
  error: string | null
  /** Where the canvas looks: saved with the view, but panning is not an undo step. */
  viewport: DiagramViewport | null
  /** Selected view node ids: editor state, not part of the document or its history. */
  selection: string[]
  /** Results of the diagram checks (P1-20): editor state, not history. */
  problems: Problem[]
  /** Worst severity per view node id, for the badges. */
  problemsByNode: Record<string, Severity>
  setProblems(problems: Problem[]): void
  /** Selected edge ids (cables): Delete on them deletes from the inventory, after a confirmation. */
  edgeSelection: string[]
  /** The document as last loaded or saved: undoing back to it is "clean" again. */
  savedDoc: DocState | null
  /** Bumped by every load, so views can reset (e.g. the viewport after reloading on a conflict). */
  loadId: number
  /** How cables are drawn (P2-08, ADR-047): physical, or the L2 view over the same layout. Editor state, not history. */
  lens: Lens
  /** L2 view: the VLAN record picked in the legend (`vlanInfo().key`) — cables carrying it stand out, the rest fade. */
  vlanFilter: string | null
  setLens(lens: Lens): void
  setVlanFilter(key: string | null): void
  setViewport(viewport: DiagramViewport): void
  setSelection(ids: string[]): void
  setEdgeSelection(ids: string[]): void
  /**
   * Server facts of a saved device after an IPAM write from the panel (ADR-034): the new version for a pending edit
   * (so the diagram save does not conflict) and the management IP — in the document and its history, no undo step.
   */
  syncDevice(id: string, facts: { version?: number; mgmtIp?: string }): void
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

/** Selected ids that still exist after a change: view nodes and annotations (a selected frame stays selected while
 * it is resized or moved). */
function liveSelection(selection: string[], doc: DocState): string[] {
  if (selection.length === 0) return selection
  const ids = new Set(doc.view.nodes.map((n) => n.id))
  for (const a of doc.view.annotations) ids.add(ANN + a.id)
  const live = selection.filter((id) => ids.has(id))
  return live.length === selection.length ? selection : live
}

function liveEdges(selection: string[], doc: DocState): string[] {
  if (selection.length === 0) return selection
  const ids = new Set(doc.view.edges.map((e) => e.id))
  const live = selection.filter((id) => ids.has(id))
  return live.length === selection.length ? selection : live
}

/** Undo / redo landing exactly on the saved document is clean again; a conflict stays a conflict. */
function statusAfterHistory(s: DocStore, doc: DocState): SaveStatus {
  if (s.status === 'conflict') return 'conflict'
  return doc === s.savedDoc ? 'clean' : 'dirty'
}

export function createDocStore() {
  return create<DocStore>()((set, get) => ({
    meta: null,
    doc: null,
    past: [],
    future: [],
    status: 'clean',
    error: null,
    viewport: null,
    selection: [],
    edgeSelection: [],
    problems: [],
    problemsByNode: {},
    setProblems: (problems) => {
      const byNode: Record<string, Severity> = {}
      for (const p of problems) {
        if (p.target.kind !== 'node') continue
        const cur = byNode[p.target.id]
        if (!cur || SEVERITY_ORDER[p.severity] < SEVERITY_ORDER[cur])
          byNode[p.target.id] = p.severity
      }
      set({ problems, problemsByNode: byNode })
    },
    savedDoc: null,
    loadId: 0,
    lens: 'physical',
    vlanFilter: null,
    setLens: (lens) => set({ lens, vlanFilter: lens === 'l2' ? get().vlanFilter : null }),
    setVlanFilter: (vlanFilter) => set({ vlanFilter }),
    setViewport: (viewport) => set({ viewport }),
    setSelection: (ids) => {
      const cur = get().selection
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return
      set({ selection: ids })
    },
    setEdgeSelection: (ids) => {
      const cur = get().edgeSelection
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return
      set({ edgeSelection: ids })
    },
    syncDevice: (id, facts) => {
      // The same snapshot patches to the same object, so "back at the saved document" stays recognisable.
      const done = new Map<DocState, DocState>()
      const patch = (doc: DocState): DocState => {
        const seen = done.get(doc)
        if (seen) return seen
        const out = patchOne(doc)
        done.set(doc, out)
        return out
      }
      const patchOne = (doc: DocState): DocState => {
        const card = doc.devices[id]
        const edit = doc.deviceEdits[id]
        const cardChanged = card && facts.mgmtIp !== undefined && card.mgmtIp !== facts.mgmtIp
        const editChanged = edit && facts.version !== undefined && edit.version !== facts.version
        if (!cardChanged && !editChanged) return doc
        return produce(doc, (d) => {
          if (cardChanged) d.devices[id]!.mgmtIp = facts.mgmtIp
          if (editChanged) d.deviceEdits[id]!.version = facts.version!
        })
      }
      const s = get()
      if (!s.doc) return
      set({
        doc: patch(s.doc),
        past: s.past.map((e) => ({ ...e, doc: patch(e.doc) })),
        future: s.future.map(patch),
        savedDoc: s.savedDoc && patch(s.savedDoc),
      })
    },
    load: (detail) => {
      const doc = docFromDetail(detail)
      set((s) => ({
        meta: detail.diagram,
        doc,
        savedDoc: doc,
        past: [],
        future: [],
        status: 'clean',
        error: null,
        viewport: detail.view.viewport ?? null,
        selection: [],
        edgeSelection: [],
        loadId: s.loadId + 1,
        // Another diagram opens with the view of its layer; reloading the same one keeps the current view.
        ...(s.meta?.id === detail.diagram.id
          ? {}
          : {
              lens: detail.diagram.layer === 'l2' ? ('l2' as const) : ('physical' as const),
              vlanFilter: null,
            }),
      }))
    },
    restore: (doc) =>
      set((s) => ({
        // Drafts kept before the L2 view have no VLAN facts: the loaded diagram's are still right.
        doc: doc.vlans ? doc : { ...doc, vlans: s.doc?.vlans, gateways: s.doc?.gateways },
        past: [],
        future: [],
        status: 'dirty',
        error: null,
        selection: liveSelection(s.selection, doc),
      })),
    dispatch: (command) => {
      const { doc, past, status } = get()
      // The answer of a save replaces the document: edits made meanwhile would be lost, so they wait.
      if (!doc || status === 'saving') return
      const next = produce(doc, (draft) => command.apply(draft))
      if (next === doc) return // no-op command
      const top = past.at(-1)
      const merged = command.mergeKey !== undefined && top?.mergeKey === command.mergeKey
      set({
        doc: next,
        past: merged ? past : [...past, { doc, mergeKey: command.mergeKey }].slice(-DOC_UNDO_LIMIT),
        future: [],
        status: status === 'conflict' ? 'conflict' : 'dirty',
        selection: liveSelection(get().selection, next),
        edgeSelection: liveEdges(get().edgeSelection, next),
      })
    },
    undo: () => {
      const { doc, past, future, status } = get()
      const prev = past.at(-1)
      if (!doc || !prev || status === 'saving') return
      set({
        doc: prev.doc,
        past: past.slice(0, -1),
        future: [doc, ...future],
        status: statusAfterHistory(get(), prev.doc),
        selection: liveSelection(get().selection, prev.doc),
        edgeSelection: liveEdges(get().edgeSelection, prev.doc),
      })
    },
    redo: () => {
      const { doc, past, future, status } = get()
      const [next, ...rest] = future
      if (!doc || !next || status === 'saving') return
      set({
        doc: next,
        past: [...past, { doc }].slice(-DOC_UNDO_LIMIT),
        future: rest,
        status: statusAfterHistory(get(), next),
        selection: liveSelection(get().selection, next),
        edgeSelection: liveEdges(get().edgeSelection, next),
      })
    },
    saveRequest: () => {
      const { doc, meta, viewport } = get()
      if (!doc || !meta) return null
      const view = viewport ? { ...doc.view, viewport } : doc.view
      return { version: meta.version, view, changes: changesOf(doc) }
    },
    setStatus: (status, error = null) => set({ status, error }),
    saved: (detail) => {
      const doc = docFromDetail(detail)
      set((s) => ({
        meta: detail.diagram,
        doc,
        savedDoc: doc,
        past: [],
        future: [],
        status: 'clean',
        error: null,
        selection: liveSelection(s.selection, doc),
        edgeSelection: liveEdges(s.edgeSelection, doc),
      }))
    },
  }))
}

export type DocStoreApi = ReturnType<typeof createDocStore>
