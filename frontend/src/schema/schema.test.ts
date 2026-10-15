/// <reference types="node" />
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// Ensures the generated types compile and are importable inside the frontend.
import type { NtbProjectFile } from '../types/ntb'

const repoRoot = path.resolve(__dirname, '../../..')
const schemaPath = path.join(repoRoot, 'schema/ntb.schema.json')
const samplePath = path.join(repoRoot, 'testdata/sample-small.ntb.json')

function compile() {
  const ajv = new Ajv2020({ strict: true, allErrors: true })
  addFormats(ajv)
  return ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')))
}

describe('ntb.schema.json', () => {
  it('validates testdata/sample-small.ntb.json', () => {
    const validate = compile()
    const doc = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as NtbProjectFile
    expect(validate(doc)).toBe(true)
  })

  it('rejects a file with a wrong schemaVersion', () => {
    const validate = compile()
    const doc = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    doc.schemaVersion = '9.9.9'
    expect(validate(doc)).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({ message: 'must be equal to constant' }),
    )
  })

  it('rejects a VLAN id out of range', () => {
    const validate = compile()
    const doc = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    doc.vlans[0].vlanId = 5000
    expect(validate(doc)).toBe(false)
  })

  it('rejects unknown properties (typos are caught)', () => {
    const validate = compile()
    const doc = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    doc.devices[0].hostnmae = 'typo'
    expect(validate(doc)).toBe(false)
  })
})
