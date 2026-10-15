import Dexie, { type Table } from 'dexie'
import type { NtbData } from '../model/types'
import type { NtbProjectFile } from '../types/ntb'
import { toNtbProjectFile } from '../model/io'

interface SessionRecord {
  id: string
  savedAt: string
  file: NtbProjectFile
}

class AutosaveDB extends Dexie {
  sessions!: Table<SessionRecord, string>

  constructor() {
    super('ntb')
    this.version(1).stores({ sessions: 'id' })
  }
}

let db: AutosaveDB | null = null

function getDb(): AutosaveDB {
  if (db === null) db = new AutosaveDB()
  return db
}

export async function saveSession(data: NtbData): Promise<void> {
  await getDb().sessions.put({
    id: 'current',
    savedAt: new Date().toISOString(),
    file: toNtbProjectFile(data),
  })
}

export async function loadSession(): Promise<SessionRecord | undefined> {
  return getDb().sessions.get('current')
}

export async function clearSession(): Promise<void> {
  await getDb().sessions.delete('current')
}

// ---- dirty tracking (module-level, shared between the hook and toolbar) ----

let lastSavedData: NtbData | null = null

export function isDirty(data: NtbData): boolean {
  return data !== lastSavedData
}

export function markSaved(data: NtbData): void {
  lastSavedData = data
}
