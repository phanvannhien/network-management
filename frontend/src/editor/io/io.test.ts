/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromNtbProjectFile, toNtbProjectFile } from '../model/io'
import { readProjectFile } from './file'
import { validateProjectFile } from './schemaValidate'

// .ntb.json is an export/import format only (ADR-015); these tests back P1-22.
const samplePath = path.resolve(__dirname, '../../../../testdata/sample-small.ntb.json')
const sampleFile = () => JSON.parse(fs.readFileSync(samplePath, 'utf8'))

describe('io: .ntb.json export → import', () => {
  it('file round-trip preserves the model exactly', () => {
    const original = fromNtbProjectFile(sampleFile())
    const reparsed = JSON.parse(JSON.stringify(toNtbProjectFile(original), null, 2))
    expect(validateProjectFile(reparsed).ok).toBe(true)
    expect(fromNtbProjectFile(reparsed)).toEqual(original)
  })
})

describe('io: schema validation on import', () => {
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
