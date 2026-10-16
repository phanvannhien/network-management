import Dexie, { type Table } from 'dexie'
import type { DocState } from './types'

// Unsent editor work survives a closed tab or a crash (P1-13, Stack: Dexie "only unsaved drafts"). One draft per
// diagram, keyed by its id; it records the version it was based on so a stale draft can be told apart.

export interface Draft {
  diagramId: string
  baseVersion: number
  doc: DocState
  savedAt: string
}

export interface DraftStore {
  get(diagramId: string): Promise<Draft | undefined>
  put(draft: Draft): Promise<void>
  remove(diagramId: string): Promise<void>
}

class DraftDb extends Dexie {
  drafts!: Table<Draft, string>
  constructor() {
    super('ntb-drafts')
    this.version(1).stores({ drafts: 'diagramId' })
  }
}

let db: DraftDb | null = null

const dexieStore: DraftStore = {
  async get(id) {
    db ??= new DraftDb()
    return db.drafts.get(id)
  },
  async put(draft) {
    db ??= new DraftDb()
    await db.drafts.put(draft)
  },
  async remove(id) {
    db ??= new DraftDb()
    await db.drafts.delete(id)
  },
}

/** In-memory drafts where IndexedDB is missing (tests, some private modes). */
export function memoryDraftStore(): DraftStore {
  const m = new Map<string, Draft>()
  return {
    get: async (id) => m.get(id),
    put: async (d) => void m.set(d.diagramId, structuredClone(d)),
    remove: async (id) => void m.delete(id),
  }
}

let current: DraftStore = typeof indexedDB === 'undefined' ? memoryDraftStore() : dexieStore

export function draftStore(): DraftStore {
  return current
}

/** Tests swap the backend. */
export function setDraftStore(s: DraftStore) {
  current = s
}
