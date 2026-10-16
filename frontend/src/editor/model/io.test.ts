/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromNtbProjectFile, toNtbProjectFile } from './io'

const samplePath = path.resolve(__dirname, '../../../../testdata/sample-small.ntb.json')

describe('io: NtbData <-> .ntb.json', () => {
  it('round-trips testdata/sample-small.ntb.json exactly', () => {
    const file = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    const data = fromNtbProjectFile(file)
    expect(toNtbProjectFile(data)).toEqual(file)
  })

  it('keys entities by id after import', () => {
    const file = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    const data = fromNtbProjectFile(file)
    expect(Object.keys(data.devices)).toHaveLength(file.devices.length)
    expect(Object.keys(data.links)).toHaveLength(file.links.length)
    for (const device of file.devices) {
      expect(data.devices[device.id].hostname).toBe(device.hostname)
    }
  })
})
