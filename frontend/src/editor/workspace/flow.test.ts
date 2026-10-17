import { describe, expect, it } from 'vitest'
import { reuseUnchanged } from './flow'

// CLAUDE.md / SRS §14: moving one node must not hand React Flow new objects for every other node and cable.
describe('reuseUnchanged', () => {
  const node = (id: string, x: number, data = { refId: id }) => ({
    id,
    position: { x, y: 0 },
    data,
    selected: false,
  })

  it('keeps the previous object of every item that did not change', () => {
    const cache = new Map<string, ReturnType<typeof node>>()
    const shared = { refId: 'b' }
    const first = reuseUnchanged(cache, [node('a', 0), node('b', 10, shared)])
    const second = reuseUnchanged(cache, [node('a', 5), node('b', 10, shared)])
    expect(second[0]).not.toBe(first[0])
    expect(second[0]!.position.x).toBe(5)
    expect(second[1]).toBe(first[1])
  })

  it('compares nested objects and arrays member-wise, and forgets removed items', () => {
    const cache = new Map<string, { id: string; data: { bundle: string[] } }>()
    const bundle = ['l1', 'l2']
    const [e1] = reuseUnchanged(cache, [{ id: 'e', data: { bundle } }])
    const [same] = reuseUnchanged(cache, [{ id: 'e', data: { bundle } }])
    expect(same).toBe(e1)
    const [grown] = reuseUnchanged(cache, [{ id: 'e', data: { bundle: [...bundle, 'l3'] } }])
    expect(grown).not.toBe(e1)
    reuseUnchanged(cache, [])
    expect(cache.size).toBe(0)
  })
})
