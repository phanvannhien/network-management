import { describe, expect, it } from 'vitest'
import { toFlowEdges } from '../workspace/flow'
import { hostPart, isPublic, isTransit, planL3 } from './l3'
import { emptyView, type DocState } from './types'

// P2-08 (ADR-047): an L3 page drawn from IPAM.

const LAN = 's-lan'
const WAN = 's-wan'
const P2P = 's-p2p'

function doc(nodes: DocState['view']['nodes']): DocState {
  const dev = (id: string, type: string) => ({
    id,
    hostname: id.toUpperCase(),
    type: type as never,
    siteId: 'hq',
  })
  return {
    view: { ...emptyView(), nodes, edges: [] },
    devices: {
      isp: dev('isp', 'provider_cloud'),
      fw: dev('fw', 'firewall'),
      rtr: dev('rtr', 'router'),
      sw: dev('sw', 'poe_switch'),
    },
    groups: {
      pcs: {
        id: 'pcs',
        name: 'PCs',
        kind: 'pc',
        siteId: 'hq',
        expectedCount: null,
        ipRangeId: 'r',
        range: '',
        notes: '',
      },
    },
    links: {
      vpn: { id: 'vpn', aId: 'fw', bId: 'rtr', kind: 'logical', aPort: 'tun0', bPort: 'tun0' },
      cu: { id: 'cu', aId: 'fw', bId: 'sw', kind: 'ethernet', aPort: 'port1', bPort: 'Gi1' },
    },
    hidden: [],
    l3: {
      subnets: {
        [LAN]: {
          id: LAN,
          cidr: '10.1.20.0/24',
          vrf: '',
          gateway: '10.1.20.1',
          description: '',
          siteId: 'hq',
          vid: 20,
          vlanName: 'Office',
          vlanColor: '#2563eb',
        },
        [WAN]: {
          id: WAN,
          cidr: '203.0.113.0/29',
          vrf: '',
          gateway: '',
          description: '',
          siteId: 'hq',
          vid: null,
          vlanName: '',
          vlanColor: '',
        },
        [P2P]: {
          id: P2P,
          cidr: '10.0.0.0/30',
          vrf: '',
          gateway: '',
          description: '',
          siteId: 'hq',
          vid: null,
          vlanName: '',
          vlanColor: '',
        },
      },
      attachments: [
        {
          deviceId: 'fw',
          interfaceName: 'port1',
          interfaceKind: 'physical',
          address: '10.1.20.1/24',
          subnetId: LAN,
          isGateway: true,
        },
        {
          deviceId: 'fw',
          interfaceName: 'wan1',
          interfaceKind: 'physical',
          address: '203.0.113.2/29',
          subnetId: WAN,
          isGateway: false,
        },
        {
          deviceId: 'isp',
          interfaceName: '',
          interfaceKind: 'physical',
          address: '203.0.113.1/29',
          subnetId: WAN,
          isGateway: false,
        },
        {
          deviceId: 'fw',
          interfaceName: 'port9',
          interfaceKind: 'physical',
          address: '10.0.0.1/30',
          subnetId: P2P,
          isGateway: false,
        },
        {
          deviceId: 'rtr',
          interfaceName: 'Gi0/0',
          interfaceKind: 'physical',
          address: '10.0.0.2/30',
          subnetId: P2P,
          isGateway: false,
        },
        {
          deviceId: 'sw',
          interfaceName: 'Vlan20',
          interfaceKind: 'svi',
          address: '10.1.20.2/24',
          subnetId: LAN,
          isGateway: false,
        },
      ],
      groupSubnet: { pcs: LAN },
    },
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

const physical = [
  { id: 'n-isp', refKind: 'device' as const, refId: 'isp', x: 0, y: 0 },
  { id: 'n-fw', refKind: 'device' as const, refId: 'fw', x: 0, y: 200 },
  { id: 'n-rtr', refKind: 'device' as const, refId: 'rtr', x: 300, y: 200 },
  { id: 'n-sw', refKind: 'device' as const, refId: 'sw', x: 0, y: 400 },
  { id: 'n-pcs', refKind: 'endpoint_group' as const, refId: 'pcs', x: 0, y: 600 },
]

describe('L3 helpers', () => {
  it('knows transit subnets and host parts', () => {
    expect(isTransit('10.0.0.0/30')).toBe(true)
    expect(isTransit('10.0.0.0/31')).toBe(true)
    expect(isTransit('10.1.20.0/24')).toBe(false)
    expect(isTransit('2001:db8::/127')).toBe(true)
    expect(isPublic('203.0.113.0/29')).toBe(false) // documentation range
    expect(isPublic('14.161.0.0/29')).toBe(true)
    expect(isPublic('10.1.20.0/24')).toBe(false)
    expect(hostPart('10.1.20.1/24')).toBe('.1')
    expect(hostPart('2001:db8::1/64')).toBe(':1')
  })
})

describe('planL3', () => {
  it('places routing devices in a row, WAN above, LAN below, groups under their subnet; no bar for a /30', () => {
    const plan = planL3(doc(physical))
    const of = (id: string) => plan.find((p) => p.refId === id)
    // The plain PoE switch is not a routing device (its SVI alone does not make it one).
    expect(plan.filter((p) => p.refKind === 'device').map((p) => p.refId)).toEqual([
      'isp',
      'fw',
      'rtr',
    ])
    expect(of(P2P)).toBeUndefined()
    expect(of(WAN)!.y).toBeLessThan(0)
    expect(of(LAN)!.y).toBeGreaterThan(0)
    expect(of('pcs')!.y).toBeGreaterThan(of(LAN)!.y)
  })

  it('adds only what is missing, after what the page has', () => {
    const existing = [
      { id: 'l-fw', refKind: 'device' as const, refId: 'fw', x: 500, y: 50, pageId: 'p3' },
      {
        id: 'l-lan',
        refKind: 'subnet' as const,
        refId: LAN,
        x: 450,
        y: 250,
        width: 500,
        pageId: 'p3',
      },
    ]
    const plan = planL3(doc(physical), existing)
    expect(plan.map((p) => p.refId).sort()).toEqual(['isp', 'pcs', 'rtr', WAN].sort())
    expect(plan.find((p) => p.refId === 'isp')!.x).toBeGreaterThan(500)
  })
})

describe('L3 edges', () => {
  it('draws IPs down to their bars, a /30 between its routers, groups on their subnet, logical cables only', () => {
    const d = doc([
      ...physical.slice(0, 3),
      { id: 'b-lan', refKind: 'subnet', refId: LAN, x: 0, y: 400, width: 500 },
      { id: 'b-wan', refKind: 'subnet', refId: WAN, x: 0, y: -150, width: 500 },
      physical[4]!,
    ])
    d.view.edges = [
      { id: 'e-vpn', linkId: 'vpn' },
      { id: 'e-cu', linkId: 'cu' },
    ]
    const edges = toFlowEdges(d, undefined, { lens: 'physical', layer: 'l3' })
    const byId = Object.fromEntries(edges.map((e) => [e.id, e]))
    expect(byId['l3:n-fw:10.1.20.1/24']).toMatchObject({
      target: 'b-lan',
      data: { label: 'port1 .1', gateway: true },
    })
    expect(byId['l3:n-isp:203.0.113.1/29']).toMatchObject({ target: 'b-wan' })
    expect(byId[`l3p:${P2P}`]).toMatchObject({
      source: 'n-fw',
      target: 'n-rtr',
      data: { label: '10.0.0.0/30', aHost: '.1', bHost: '.2' },
    })
    expect(byId['l3g:n-pcs']).toMatchObject({ target: 'b-lan' })
    expect(byId['e-vpn']).toBeDefined()
    expect(byId['e-cu']).toBeUndefined()
  })
})
