/// <reference types="node" />
import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addDevice, addPage, replaceDocument } from '../model/commands'
import { createDevice, newId } from '../model/factory'
import { fromNtbProjectFile, toNtbProjectFile } from '../model/io'
import { createAppStore } from '../model/store'
import { clearSession, loadSession, saveSession } from './autosave'
import { readProjectFile } from './file'
import { validateProjectFile } from './schemaValidate'

const samplePath = path.resolve(__dirname, '../../../testdata/sample-small.ntb.json')
const sampleFile = () => JSON.parse(fs.readFileSync(samplePath, 'utf8'))

beforeEach(async () => {
  await clearSession()
})

describe('io: Save → Load deep equal (P1-10 Done criteria)', () => {
  it('file round-trip preserves the model exactly', async () => {
    const original = fromNtbProjectFile(sampleFile())
    const serialized = JSON.stringify(toNtbProjectFile(original), null, 2)
    const reparsed = JSON.parse(serialized)
    expect(validateProjectFile(reparsed).ok).toBe(true)
    const reloaded = fromNtbProjectFile(reparsed)
    expect(reloaded).toEqual(original)
  })

  it('autosave session round-trip preserves the model exactly', async () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: newId(), name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    store
      .getState()
      .dispatch(
        addDevice(
          createDevice({ type: 'l2_switch', hostname: 'SW-01' }),
          Object.keys(store.getState().data.pages)[0],
          10,
          10,
        ),
      )

    const data = store.getState().data
    await saveSession(data)
    const session = await loadSession()
    expect(session).toBeDefined()
    const reloaded = fromNtbProjectFile(session!.file)
    expect(reloaded).toEqual(data)
  })

  it('restore replaces an empty document with the saved session', () => {
    const store = createAppStore()
    const saved = fromNtbProjectFile(sampleFile())
    store.getState().dispatch(replaceDocument(saved))
    expect(store.getState().data).toEqual(saved)

    // One undo step brings back the empty document.
    store.getState().undo()
    expect(Object.keys(store.getState().data.devices)).toHaveLength(0)
  })
})

describe('io: schema validation on load', () => {
  it('accepts the sample file', () => {
    expect(validateProjectFile(sampleFile()).ok).toBe(true)
  })

  it('rejects a corrupted document', () => {
    const doc = sampleFile()
    delete doc.schemaVersion
    const result = validateProjectFile(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('readProjectFile parses a File-like object', async () => {
    const file = new File([JSON.stringify(sampleFile())], 'sample.ntb.json', {
      type: 'application/json',
    })
    const data = await readProjectFile(file)
    expect(Object.keys(data.devices)).toHaveLength(10)
  })

  it('readProjectFile throws on invalid schema', async () => {
    const doc = sampleFile()
    doc.schemaVersion = '9.9.9'
    const file = new File([JSON.stringify(doc)], 'bad.ntb.json', { type: 'application/json' })
    await expect(readProjectFile(file)).rejects.toThrow(/schema/)
  })
})
