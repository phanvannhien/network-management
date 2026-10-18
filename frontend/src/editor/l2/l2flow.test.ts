import { describe, expect, it } from 'vitest'
import { emptyView, type DocState, type LinkCard } from '../doc/types'
import { litNodes, reuseUnchanged, toFlowEdges } from '../workspace/flow'
import { legendItems } from './legend'
import type { PortL2 } from './l2'

// P2-08 (ADR-047): the L2 view over the same layout — cables by what they carry, a LAG as one line, the VLAN filter.

const port = (p: Partial<PortL2>): PortL2 => ({
  mode: '',
  access: null,
  native: null,
  allowed: '',
  lagId: null,
  lagName: '',
  ...p,
})

function doc(links: LinkCard[]): DocState {
  const dev = (id: string, siteId: string, siteCode: string) => ({
    id,
    hostname: id.toUpperCase(),
    type: 'l2_switch' as const,
    siteId,
    siteCode,
  })
  return {
    view: {
      ...emptyView(),
      nodes: [
        { id: 'n-core', refKind: 'device', refId: 'core', x: 0, y: 0 },
        { id: 'n-acc', refKind: 'device', refId: 'acc', x: 300, y: 0 },
        { id: 'n-cam', refKind: 'device', refId: 'cam', x: 600, y: 0 },
        { id: 'n-hn', refKind: 'device', refId: 'hn', x: 900, y: 0 },
      ],
      edges: links.map((l) => ({ id: `e-${l.id}`, linkId: l.id })),
    },
    devices: {
      core: dev('core', 'hcm', 'HCM01'),
      acc: dev('acc', 'hcm', 'HCM01'),
      cam: dev('cam', 'hcm', 'HCM01'),
      hn: dev('hn', 'hn', 'HN01'),
    },
    groups: {},
    links: Object.fromEntries(links.map((l) => [l.id, l])),
    hidden: [],
    vlans: [
      { vid: 20, name: 'Camera', color: '#16a34a', siteId: 'hcm' },
      { vid: 20, name: 'Kho HN', color: '#2563eb', siteId: 'hn' },
      { vid: 99, name: 'MGMT', color: '#64748b', siteId: null },
    ],
    gateways: [
      { deviceId: 'core', vid: 20, siteId: 'hcm', address: '10.1.20.1', interfaceName: 'Vlan20' },
    ],
    newDevices: {},
    newDeviceOrder: [],
    deviceEdits: {},
    deletedDevices: [],
    newLinks: {},
    newLinkOrder: [],
    linkEdits: {},
    deletedLinks: [],
  }
}

const trunk = (lag = '') =>
  port({ mode: 'trunk', allowed: '20,99', native: 99, lagId: lag || null, lagName: lag })
const link = (
  id: string,
  aId: string,
  bId: string,
  a: PortL2,
  b: PortL2,
  kind = 'fiber',
): LinkCard => ({
  id,
  aId,
  bId,
  kind: kind as LinkCard['kind'],
  aPort: `${id}-a`,
  bPort: `${id}-b`,
  aL2: a,
  bL2: b,
})

const d = doc([
  link('l1', 'core', 'acc', trunk('po1'), trunk('po2')),
  link('l2', 'core', 'acc', trunk('po1'), trunk('po2')),
  link('l3', 'acc', 'cam', port({ mode: 'access', access: 20 }), port({}), 'ethernet'),
  link('l4', 'core', 'acc', port({}), port({}), 'power'),
  link(
    'l5',
    'acc',
    'hn',
    port({ mode: 'access', access: 20 }),
    port({ mode: 'access', access: 20 }),
    'ethernet',
  ),
])

describe('L2 view edges', () => {
  it('leaves the physical view as it was, with a ring across the LAG members', () => {
    const edges = toFlowEdges(d)
    expect(edges).toHaveLength(5)
    const ring = edges.find((e) => e.data?.ring)
    expect(ring?.data).toMatchObject({ ring: 'po1', ringFrom: 0, ringTo: 1 })
    expect(edges.every((e) => !e.data?.l2)).toBe(true)
  })

  it('draws a LAG as one line named by its LAGs, hides power, classifies each cable', () => {
    const edges = toFlowEdges(d, undefined, { lens: 'l2' })
    expect(edges.map((e) => e.data!.linkId).sort()).toEqual(['l1', 'l3', 'l5'])
    const lag = edges.find((e) => e.data!.linkId === 'l1')!
    expect(lag.data).toMatchObject({
      lag: 'po1',
      lagCount: 2,
      aPort: 'po1',
      bPort: 'po2',
      bundle: ['l1', 'l2'],
    })
    expect(lag.className).toContain('ntb-l2-trunk')
    expect(edges.find((e) => e.data!.linkId === 'l3')!.className).toContain('ntb-l2-access')
  })

  it('fades what does not carry the picked VLAN record, not the same number of another site', () => {
    const edges = toFlowEdges(d, undefined, { lens: 'l2', vlanFilter: 'hcm:20' })
    const cls = (id: string) => edges.find((e) => e.data!.linkId === id)!.className ?? ''
    expect(cls('l1')).not.toContain('faded')
    expect(cls('l3')).not.toContain('faded')
    // acc (HCM) ↔ hn (HN) carries VLAN 20 — the HCM record at the HCM end.
    expect(cls('l5')).not.toContain('faded')
    const hnOnly = toFlowEdges(d, undefined, { lens: 'l2', vlanFilter: 'hcm:99' })
    expect(hnOnly.find((e) => e.data!.linkId === 'l3')!.className).toContain('ntb-l2-faded')
    expect([...litNodes(d, { lens: 'l2', vlanFilter: 'hcm:20' })!].sort()).toEqual([
      'n-acc',
      'n-cam',
      'n-core',
      'n-hn',
    ])
    expect(litNodes(d, { lens: 'l2', vlanFilter: 'hn:20' })!.has('n-cam')).toBe(false)
    expect(litNodes(d, { lens: 'physical', vlanFilter: 'hcm:20' })).toBeNull()
  })

  it('hands React Flow the same edge objects when nothing changed', () => {
    const cache = new Map()
    const first = reuseUnchanged(cache, toFlowEdges(d, undefined, { lens: 'l2' }))
    const again = reuseUnchanged(cache, toFlowEdges(d, undefined, { lens: 'l2' }))
    const single = (es: typeof first) => es.find((e) => e.data!.linkId === 'l3')
    expect(single(again)).toBe(single(first))
  })
})

describe('VLAN legend', () => {
  it('lists VLAN records with their site when two share a number, and marks the gateway', () => {
    const items = legendItems(d)
    expect(items.map((i) => [i.key, i.name, i.where, i.gateway])).toEqual([
      ['hcm:20', 'Camera', 'HCM01', true],
      ['hn:20', 'Kho HN', 'HN01', false],
      ['org:99', 'MGMT', '', false],
    ])
  })
})
