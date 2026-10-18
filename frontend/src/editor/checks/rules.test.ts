import { describe, expect, it } from 'vitest'
import { emptyView, type DocState } from '../doc/types'
import {
  badHostAddress,
  speedMbps,
  buildCheckInput,
  edgeAddress,
  runChecks,
  type CheckIface,
  type CheckInput,
  type CheckLink,
} from './rules'
import type { ValidationContext } from './types'

const D1 = '00000000-0000-0000-0000-0000000000d1'
const D2 = '00000000-0000-0000-0000-0000000000d2'
const G1 = '00000000-0000-0000-0000-0000000000a1'
const SITE = '00000000-0000-0000-0000-0000000000f1'
const SITE2 = '00000000-0000-0000-0000-0000000000f2'

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  devices: [],
  interfaces: [],
  ips: [],
  links: [],
  subnets: [],
  groups: [],
  conflicts: [],
  ...over,
})

const port = (id: string, deviceId: string, over: Partial<CheckIface> = {}): CheckIface => ({
  id,
  deviceId,
  name: id,
  kind: 'physical',
  media: 'RJ45',
  speed: '1G',
  mode: '',
  accessVlan: null,
  nativeVlan: null,
  allowedVlans: '',
  lagId: null,
  ...over,
})

const cable = (
  id: string,
  aIface: string | null,
  bIface: string | null,
  kind = 'ethernet',
): CheckLink => ({
  id,
  kind,
  aKind: 'device',
  aId: D1,
  aIface,
  bKind: 'device',
  bId: D2,
  bIface,
})

/** Two devices on the view, cabled through `links` (or not). */
function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    nodes: [
      { id: 'n1', refKind: 'device', refId: D1, x: 0, y: 0 },
      { id: 'n2', refKind: 'device', refId: D2, x: 400, y: 0 },
    ],
    devices: {
      [D1]: {
        hostname: 'SW01',
        type: 'switch',
        siteId: SITE,
        draft: false,
        clusterKind: '',
        lifecycle: 'active',
        eosDate: '',
      },
      [D2]: {
        hostname: 'SW02',
        type: 'switch',
        siteId: SITE,
        draft: false,
        clusterKind: '',
        lifecycle: 'active',
        eosDate: '',
      },
    },
    today: '2026-10-18',
    frames: [],
    edgeOf: { L1: 'e1' },
    links: [cable('L1', 'p1', 'p2')],
    ifaces: [port('p1', D1), port('p2', D2)],
    ctx: ctx(),
    ...over,
  }
}

// The asset note (P2-10) has its own tests; fixtures here leave S/N empty on purpose.
const rules = (i: CheckInput) =>
  runChecks(i)
    .filter((p) => p.rule !== 'missing-info')
    .map((p) => `${p.rule}:${p.severity}:${p.target.id}`)

describe('runChecks', () => {
  it('a clean pair has no problems', () => {
    expect(runChecks(input())).toEqual([])
  })

  it('shows server conflicts with their level', () => {
    const c = ctx({
      conflicts: [
        {
          kind: 'ip',
          severity: 'error',
          deviceId: D1,
          value: '10.0.0.5',
          other: 'SW09',
          otherInterface: 'Vlan1',
        },
        {
          kind: 'serial',
          severity: 'error',
          deviceId: D2,
          value: 'SN1',
          other: 'SW09',
          otherInterface: '',
        },
        {
          kind: 'ip',
          severity: 'warning',
          deviceId: D2,
          value: '203.0.113.9',
          other: 'FW',
          otherInterface: '',
        },
      ],
    })
    expect(rules(input({ ctx: c }))).toEqual([
      'duplicate-ip:error:n1',
      'duplicate-serial:error:n2',
      'duplicate-ip:warning:n2',
    ])
  })

  it('flags an unsaved device reusing a hostname on the diagram', () => {
    const i = input()
    i.devices[D2] = { ...i.devices[D2]!, hostname: 'sw01', draft: true }
    expect(rules(i)).toContain('duplicate-hostname:error:n2')
  })

  it('IP that is no host address is an error; network / broadcast a warning (also bare /32 via IPAM)', () => {
    const ip = (address: string, vrf = '') => ({
      deviceId: D1,
      interfaceId: 'p1',
      address,
      vrf,
      role: 'primary',
    })
    const c = ctx({
      ips: [
        ip('127.0.0.1/8'),
        ip('10.0.0.0/24'),
        ip('10.0.0.255/24'),
        ip('10.1.0.0/31'),
        ip('10.2.0.255/32'),
      ],
      subnets: [{ id: 's', cidr: '10.2.0.0/24', vrf: '', gateway: '', dhcp: [] }],
    })
    const out = runChecks(input({ ctx: c }))
    expect(out.map((p) => `${p.rule}:${p.params.ip}`)).toEqual([
      'ip-format:127.0.0.1/8',
      'ip-edge:10.0.0.0/24',
      'ip-edge:10.0.0.255/24',
      'ip-edge:10.2.0.255/32',
    ])
    expect(out[0]!.severity).toBe('error')
    expect(out[1]!.severity).toBe('warning')
  })

  it('a mask that leaves out the IPAM gateway of the subnet is a warning (gateway outside subnet)', () => {
    const ip = (address: string, interfaceId = 'p1') => ({
      deviceId: D1,
      interfaceId,
      address,
      vrf: '',
      role: 'primary',
    })
    const c = ctx({
      ips: [
        ip('10.0.1.5/24'),
        ip('10.0.0.9/23'),
        ip('10.0.0.1/24'),
        ip('10.0.1.6/32'),
        ip('10.9.0.5/24'),
      ],
      subnets: [
        { id: 's', cidr: '10.0.0.0/23', vrf: '', gateway: '10.0.0.1', dhcp: [] },
        { id: 't', cidr: '10.9.0.0/24', vrf: '', gateway: '', dhcp: [] },
      ],
    })
    const out = runChecks(input({ ctx: c })).filter((p) => p.rule === 'gateway-mask')
    // /24 in the /23 cannot reach .0.1; the right mask, the gateway itself, a host route and a subnet without gateway pass.
    expect(out.map((p) => `${p.params.ip}>${p.params.gateway}`)).toEqual(['10.0.1.5/24>10.0.0.1'])
    expect(out[0]!.severity).toBe('warning')
  })

  it('more than one exclusive cable on a port is an error on each cable; PON and wireless share', () => {
    const i = input({
      edgeOf: { L1: 'e1', L2: 'e2' },
      links: [cable('L1', 'p1', 'p2'), cable('L2', 'p1', 'p3')],
      ifaces: [port('p1', D1), port('p2', D2), port('p3', D2)],
    })
    expect(rules(i)).toEqual(['port-multi:error:e1', 'port-multi:error:e2'])
    i.ifaces[0] = port('p1', D1, { media: 'PON' })
    i.links = [cable('L1', 'p1', 'p2', 'fiber'), cable('L2', 'p1', 'p3', 'fiber')]
    i.ifaces[1] = port('p2', D2, { media: 'PON' })
    i.ifaces[2] = port('p3', D2, { media: 'PON' })
    expect(rules(i).filter((r) => r.startsWith('port-multi'))).toEqual([])
  })

  it('physical cable on a virtual or LAG interface is an error; a logical one is fine', () => {
    const i = input({ ifaces: [port('p1', D1, { kind: 'lag' }), port('p2', D2, { kind: 'svi' })] })
    expect(rules(i)).toEqual(['cable-virtual:error:e1', 'cable-virtual:error:e1'])
    i.links = [cable('L1', 'p1', 'p2', 'logical')]
    expect(rules(i)).toEqual([])
  })

  it('RJ45 into SFP and different speeds are warnings', () => {
    const i = input({ ifaces: [port('p1', D1), port('p2', D2, { media: 'SFP+', speed: '10G' })] })
    expect(rules(i)).toEqual(['media-mismatch:info:e1', 'speed-mismatch:info:e1'])
  })

  it('routed ends in different subnets warn; host routes, L2 ports and LAG parents are handled', () => {
    const ip = (deviceId: string, interfaceId: string, address: string) => ({
      deviceId,
      interfaceId,
      address,
      vrf: '',
      role: 'primary',
    })
    const i = input({
      ctx: ctx({ ips: [ip(D1, 'p1', '10.0.0.1/30'), ip(D2, 'p2', '10.0.1.2/30')] }),
    })
    expect(rules(i)).toEqual(['l3-subnet:warning:e1'])
    i.ctx = ctx({ ips: [ip(D1, 'p1', '10.0.0.1/30'), ip(D2, 'p2', '10.0.0.2/30')] })
    expect(rules(i)).toEqual([])
    i.ctx = ctx({ ips: [ip(D1, 'p1', '10.0.0.1/32'), ip(D2, 'p2', '10.0.1.2/30')] })
    expect(rules(i)).toEqual([])
    // Member cable: the LAG parent's address speaks.
    i.ifaces = [port('p1', D1, { lagId: 'po1' }), port('p2', D2), port('po1', D1, { kind: 'lag' })]
    i.ctx = ctx({ ips: [ip(D1, 'po1', '10.9.0.1/30'), ip(D2, 'p2', '10.0.1.2/30')] })
    expect(rules(i)).toContain('l3-subnet:warning:e1')
    i.ifaces = [port('p1', D1, { mode: 'trunk' }), port('p2', D2)]
    i.ctx = ctx({ ips: [ip(D1, 'p1', '10.0.0.1/30'), ip(D2, 'p2', '10.0.1.2/30')] })
    expect(rules(i)).toEqual([])
  })

  it('group member outside the range warns on the group node', () => {
    const i = input({
      nodes: [...input().nodes, { id: 'ng', refKind: 'endpoint_group', refId: G1, x: 0, y: 300 }],
      links: [
        cable('L1', 'p1', 'p2'),
        { ...cable('L2', null, null), bKind: 'endpoint_group', bId: G1 },
      ],
      ctx: ctx({
        groups: [
          {
            id: G1,
            name: 'Cameras',
            rangeStart: '10.0.5.10',
            rangeEnd: '10.0.5.50',
            members: [
              { name: 'cam1', ip: '10.0.5.20' },
              { name: 'cam2', ip: '10.0.6.20' },
            ],
          },
        ],
      }),
    })
    expect(rules(i)).toContain('member-outside-range:warning:ng')
    expect(runChecks(i).filter((p) => p.rule === 'member-outside-range')).toHaveLength(1)
  })

  it('VLAN fields that do not fit the port mode warn', () => {
    const i = input({
      ifaces: [
        port('p1', D1, { mode: 'access', accessVlan: 10, allowedVlans: '10,20' }),
        port('p2', D2, { mode: 'trunk', accessVlan: 10 }),
        port('p3', D2, { mode: 'routed', nativeVlan: 1 }),
        port('p4', D2, { mode: 'access', accessVlan: 10 }),
      ],
    })
    expect(
      runChecks(i)
        .filter((p) => p.rule === 'vlan-mode')
        .map((p) => `${p.rule}:${p.params.port}`),
    ).toEqual(['vlan-mode:p1', 'vlan-mode:p2', 'vlan-mode:p3'])
  })

  it('LAG members: different speed warns, different media only is a note', () => {
    const lag = (a: Partial<CheckIface>, b: Partial<CheckIface>) =>
      input({
        links: [],
        ifaces: [
          port('m1', D1, { lagId: 'po1', ...a }),
          port('m2', D1, { lagId: 'po1', ...b }),
          port('po1', D1, { kind: 'lag' }),
        ],
      })
    expect(rules(lag({}, { speed: '10G' })).filter((r) => r.startsWith('lag'))).toEqual([
      'lag-speed:warning:n1',
    ])
    expect(rules(lag({}, { media: 'SFP' })).filter((r) => r.startsWith('lag'))).toEqual([
      'lag-media:info:n1',
    ])
  })

  it('cluster members: firmware warns; model warns for HA, note for stacks', () => {
    const dev = (id: string, model: string, firmware: string) => ({
      id,
      hostname: id === D1 ? 'SW01' : 'SW02',
      type: 'switch',
      serialNumber: '',
      model,
      firmware,
      lifecycle: 'active',
      clusterId: 'c1',
      siteId: SITE,
      locationId: null,
      mgmtInterfaceId: null,
    })
    const i = input({
      ctx: ctx({ devices: [dev(D1, 'C9300-48P', '17.9'), dev(D2, 'C9300-24P', '17.6')] }),
    })
    expect(rules(i)).toEqual([
      'cluster-firmware:warning:n1',
      'cluster-model:warning:n1',
      'cluster-firmware:warning:n2',
      'cluster-model:warning:n2',
    ])
    i.devices[D1]!.clusterKind = 'stack'
    expect(rules(i).filter((r) => r.startsWith('cluster-model'))).toEqual([
      'cluster-model:info:n1',
      'cluster-model:info:n2',
    ])
  })

  it('device inside the frame of another site warns (smallest frame wins)', () => {
    const i = input({
      frames: [
        { siteId: SITE2, locationId: null, x: -50, y: -50, w: 1000, h: 400 },
        { siteId: SITE, locationId: null, x: -20, y: -20, w: 200, h: 150 },
      ],
    })
    expect(rules(i)).toEqual(['frame-site:warning:n2'])
  })

  it('notes: no cable, cable without port, IPs without management interface', () => {
    const i = input({
      nodes: [...input().nodes, { id: 'n3', refKind: 'device', refId: 'd3', x: 0, y: 500 }],
      devices: {
        ...input().devices,
        d3: {
          hostname: 'AP01',
          type: 'access_point',
          siteId: SITE,
          draft: false,
          clusterKind: '',
          lifecycle: 'active',
          eosDate: '',
        },
      },
      links: [cable('L1', 'p1', null)],
      ctx: ctx({
        devices: [
          {
            id: D1,
            hostname: 'SW01',
            type: 'switch',
            serialNumber: '',
            model: '',
            firmware: '',
            lifecycle: 'active',
            clusterId: null,
            siteId: SITE,
            locationId: null,
            mgmtInterfaceId: null,
          },
        ],
        ips: [
          { deviceId: D1, interfaceId: 'p1', address: '10.0.0.1/24', vrf: '', role: 'primary' },
        ],
      }),
    })
    expect(rules(i)).toEqual(['cable-no-port:info:e1', 'no-cable:info:n3', 'no-mgmt:info:n1'])
  })
})

describe('review fixes', () => {
  const ip = (deviceId: string, interfaceId: string, address: string) => ({
    deviceId,
    interfaceId,
    address,
    vrf: '',
    role: 'primary',
  })
  it('a mask mismatch warns whichever end is A', () => {
    const ab = input({
      ctx: ctx({ ips: [ip(D1, 'p1', '10.0.0.5/30'), ip(D2, 'p2', '10.0.0.1/24')] }),
    })
    const ba = input({
      ctx: ctx({ ips: [ip(D1, 'p1', '10.0.0.1/24'), ip(D2, 'p2', '10.0.0.5/30')] }),
    })
    expect(rules(ab)).toEqual(['l3-subnet:warning:e1'])
    expect(rules(ba)).toEqual(['l3-subnet:warning:e1'])
  })
  it('a loopback carved from a pool is not its network address', () => {
    const i = input({
      ifaces: [port('p1', D1), port('p2', D2), port('lo0', D1, { kind: 'loopback' })],
      ctx: ctx({
        ips: [ip(D1, 'lo0', '10.255.255.0/32')],
        subnets: [{ id: 's', cidr: '10.255.255.0/24', vrf: '', gateway: '', dhcp: [] }],
      }),
    })
    expect(rules(i)).toEqual([])
  })
  it('speeds written differently are compared as numbers; logical cables have none', () => {
    expect(speedMbps('1G')).toBe(1000)
    expect(speedMbps('1000M')).toBe(1000)
    expect(speedMbps('1 Gbps')).toBe(1000)
    const same = input({
      ifaces: [port('p1', D1, { speed: '1000M' }), port('p2', D2, { speed: '1 Gbps' })],
    })
    expect(rules(same)).toEqual([])
    const logical = input({
      links: [cable('L1', 'p1', 'p2', 'logical')],
      ifaces: [
        port('p1', D1, { kind: 'tunnel', speed: '' }),
        port('p2', D2, { kind: 'tunnel', speed: '1G' }),
      ],
    })
    expect(rules(logical)).toEqual([])
  })
  it('an unsaved device drawn twice is not a duplicate of itself', () => {
    const i = input()
    i.devices[D2] = { ...i.devices[D2]!, draft: true }
    i.nodes.push({ id: 'n2b', refKind: 'device', refId: D2, x: 800, y: 0 })
    expect(rules(i).filter((r) => r.startsWith('duplicate'))).toEqual([])
  })
})

describe('buildCheckInput', () => {
  it('applies unsaved cables: deleted ones go, edits and new ones count', () => {
    const doc: DocState = {
      view: { ...emptyView(), nodes: [{ id: 'n1', refKind: 'device', refId: D1, x: 0, y: 0 }] },
      devices: {},
      groups: {},
      links: {},
      newDevices: {},
      deviceEdits: {},
      deletedDevices: [],
      newLinks: {
        L3: {
          a: { kind: 'device', id: D1, interfaceId: 'p1' },
          b: { kind: 'device', id: D2, interfaceId: 'p2' },
          kind: 'ethernet',
        },
      },
      linkEdits: {},
      deletedLinks: ['L1'],
    } as unknown as DocState
    const c = ctx({
      links: [
        {
          id: 'L1',
          kind: 'ethernet',
          aKind: 'device',
          aId: D1,
          aInterfaceId: 'p1',
          bKind: 'device',
          bId: D2,
          bInterfaceId: 'p2',
        },
        {
          id: 'L2',
          kind: 'ethernet',
          aKind: 'device',
          aId: D1,
          aInterfaceId: 'p5',
          bKind: 'device',
          bId: D2,
          bInterfaceId: 'p6',
        },
      ],
    })
    expect(
      buildCheckInput(doc, c)
        .links.map((l) => l.id)
        .sort(),
    ).toEqual(['L2', 'L3'])
  })
})

describe('address helpers', () => {
  it('badHostAddress', () => {
    expect(badHostAddress('10.0.0.1/24')).toBeNull()
    expect(badHostAddress('0.0.0.0/0')).toBe('unspecified')
    expect(badHostAddress('224.0.0.5/32')).toBe('multicast')
    expect(badHostAddress('169.254.1.1/16')).toBe('linkLocal')
    expect(badHostAddress('fe80::1/64')).toBeNull()
    expect(badHostAddress('nope')).toBe('format')
  })
  it('edgeAddress skips /31 and IPv6', () => {
    expect(edgeAddress('10.0.0.0/31', '', [])).toBeNull()
    expect(edgeAddress('2001:db8::/64', '', [])).toBeNull()
    expect(edgeAddress('10.0.0.0/24', '', [])?.which).toBe('network')
    expect(edgeAddress('27.72.96.43/30', '', [])).toEqual({
      which: 'broadcast',
      cidr: '27.72.96.40/30',
    })
  })

  it('a device in use whose vendor support has ended is a warning (P2-22)', () => {
    const devices = (eos: string, lifecycle = 'active') => ({
      ...input().devices,
      [D1]: { ...input().devices[D1]!, eosDate: eos, lifecycle },
    })
    const rule = (i: CheckInput) => runChecks(i).filter((p) => p.rule === 'end-of-support')
    expect(rule(input({ devices: devices('2026-10-17') }))).toEqual([
      expect.objectContaining({
        severity: 'warning',
        target: { kind: 'node', id: 'n1' },
        params: { host: 'SW01', date: '2026-10-17' },
      }),
    ])
    expect(rule(input({ devices: devices('2026-10-18') }))).toEqual([]) // the last day still counts
    expect(rule(input({ devices: devices('2020-01-01', 'spare') }))).toEqual([])
    expect(rule(input({ devices: devices('') }))).toEqual([])
  })
})

describe('DHCP pools (P2-09)', () => {
  it('flags a static IP inside a DHCP pool, and the gateway there as its own warning', async () => {
    const { dhcpPoolOf } = await import('./rules')
    const subnets = [
      {
        id: 's',
        cidr: '10.1.20.0/24',
        vrf: '',
        gateway: '10.1.20.100',
        dhcp: [{ start: '10.1.20.100', end: '10.1.20.200' }],
      },
      {
        id: 'w',
        cidr: '10.0.0.0/16',
        vrf: '',
        gateway: '',
        dhcp: [{ start: '10.0.20.0', end: '10.0.30.255' }],
      },
    ]
    expect(dhcpPoolOf('10.1.20.150/24', '', subnets)).toMatchObject({
      cidr: '10.1.20.0/24',
      gateway: false,
    })
    expect(dhcpPoolOf('10.1.20.100/24', '', subnets)).toMatchObject({ gateway: true })
    expect(dhcpPoolOf('10.1.20.10/24', '', subnets)).toBeNull()
    // Other VRF: another network.
    expect(dhcpPoolOf('10.1.20.150/24', 'GUEST', subnets)).toBeNull()
    // The most specific subnet decides (the /24 has no pool at .20.x of the /16's range).
    expect(dhcpPoolOf('10.1.20.5', '', subnets)).toBeNull()
  })
})

describe('Phase 2 rules (P2-10)', () => {
  const dev = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    hostname: id === D1 ? 'SW01' : 'SW02',
    type: 'l2_switch',
    serialNumber: 'S1',
    model: '',
    firmware: '',
    lifecycle: 'active',
    clusterId: null,
    siteId: SITE,
    locationId: null,
    mgmtInterfaceId: null,
    partNumber: 'C9200',
    managed: true,
    ...over,
  })
  const of = (i: CheckInput) =>
    runChecks(i).filter((p) => !['no-cable', 'cable-no-port'].includes(p.rule))

  it('VLAN mismatches on a cable, once per LAG pair', () => {
    const access = (id: string, d: string, vid: number) =>
      port(id, d, { mode: 'access', accessVlan: vid })
    expect(rules(input({ ifaces: [access('p1', D1, 20), access('p2', D2, 30)] }))).toEqual([
      'vlan-access:warning:e1',
    ])
    const trunk = (id: string, d: string, o: Partial<CheckIface>) =>
      port(id, d, { mode: 'trunk', allowedVlans: '10,20', ...o })
    expect(
      rules(
        input({
          ifaces: [trunk('p1', D1, { nativeVlan: 99 }), trunk('p2', D2, { nativeVlan: 1 })],
        }),
      ),
    ).toEqual(['vlan-native:warning:e1'])
    // Two members of one LAG pair with the LAG settings on the port-channels: one problem.
    const lagged = input({
      links: [cable('L1', 'm1', 'm2'), cable('L2', 'm3', 'm4')],
      edgeOf: { L1: 'e1', L2: 'e2' },
      ifaces: [
        port('po1', D1, { kind: 'lag', mode: 'trunk', allowedVlans: '10', nativeVlan: 99 }),
        port('po2', D2, { kind: 'lag', mode: 'trunk', allowedVlans: '10', nativeVlan: 1 }),
        port('m1', D1, { lagId: 'po1' }),
        port('m3', D1, { lagId: 'po1' }),
        port('m2', D2, { lagId: 'po2' }),
        port('m4', D2, { lagId: 'po2' }),
      ],
    })
    expect(rules(lagged).filter((r) => r.startsWith('vlan-native'))).toHaveLength(1)
    // An access port facing a camera (no mode): nothing.
    expect(rules(input({ ifaces: [access('p1', D1, 20), port('p2', D2)] }))).toEqual([])
  })

  it('a VLAN on access ports that no cabled trunk carries', () => {
    const c = ctx({ devices: [dev(D1), dev(D2)] })
    const i = input({
      ctx: c,
      links: [
        cable('L1', 'up', 'p2'),
        { ...cable('L2', 'a1', null), bKind: 'endpoint_group', bId: G1 },
      ],
      edgeOf: { L1: 'e1' },
      ifaces: [
        port('up', D1, { mode: 'trunk', allowedVlans: '10,20' }),
        port('p2', D2, { mode: 'trunk', allowedVlans: '10,20' }),
        port('a1', D1, { mode: 'access', accessVlan: 30 }),
      ],
    })
    expect(of(i).map((p) => `${p.rule}:${p.params.vlan}`)).toContain('vlan-isolated:30')
    // An uplink whose allowed list nobody filled in: no claim.
    const open = {
      ...i,
      ifaces: i.ifaces.map((x) => (x.id === 'up' ? { ...x, allowedVlans: '' } : x)),
    }
    expect(of(open).some((p) => p.rule === 'vlan-isolated')).toBe(false)
    // Routed on the switch itself: an SVI named the H3C way, or a custom name with its VLAN filled in.
    for (const svi of [
      port('s1', D1, { kind: 'svi', name: 'Vlan-interface30' }),
      port('s1', D1, { kind: 'svi', name: 'cam-gw', accessVlan: 30 }),
    ])
      expect(of({ ...i, ifaces: [...i.ifaces, svi] }).some((p) => p.rule === 'vlan-isolated')).toBe(
        false,
      )
  })

  it('duplex: forced against auto below 1G warns, at 1G is a note, full vs half warns, optics are skipped', () => {
    const pair = (da: string, db: string, speed = '100M', media = 'RJ45') =>
      runChecks(
        input({
          ifaces: [
            port('p1', D1, { duplex: da, speed, media }),
            port('p2', D2, { duplex: db, speed, media }),
          ],
        }),
      )
        .filter((p) => p.rule === 'duplex-mismatch')
        .map((p) => p.severity)
    expect(pair('auto', 'full')).toEqual(['warning'])
    expect(pair('auto', 'full', '1G')).toEqual(['info'])
    expect(pair('full', 'half', '1G')).toEqual(['warning'])
    expect(pair('auto', 'half')).toEqual(['info'])
    expect(pair('full', 'full')).toEqual([])
    expect(pair('auto', 'full', '1G', 'SFP')).toEqual([])
  })

  it('active devices missing S/N, part number, or a location where the site has some', () => {
    const c = ctx({
      devices: [
        dev(D1, { serialNumber: '', partNumber: '' }),
        dev(D2, { lifecycle: 'planned', serialNumber: '' }),
      ],
      sitesWithLocations: [SITE],
    })
    const found = of(input({ ctx: c })).filter((p) => p.rule === 'missing-info')
    expect(found.map((p) => [p.target.id, p.params.fields])).toEqual([
      ['n1', 'serial,part,location'],
    ])
  })

  it('a password shared by many devices (SNMP communities exempt)', () => {
    const many = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`)
    const c = ctx({
      devices: [dev(D1), dev(D2)],
      credentials: [
        { id: 'c1', name: 'Admin SW', kind: 'ssh', deviceIds: [D2, ...many], logicalCount: 7 },
        { id: 'c2', name: 'public', kind: 'snmp', deviceIds: [D1, ...many], logicalCount: 7 },
        // Six boxes that are one stack and one HA pair: two devices, not shared enough.
        { id: 'c4', name: 'Stack', kind: 'ssh', deviceIds: many, logicalCount: 2 },
        { id: 'c3', name: 'Few', kind: 'ssh', deviceIds: [D1, D2], logicalCount: 2 },
      ],
    })
    expect(
      of(input({ ctx: c }))
        .filter((p) => p.rule === 'credential-shared')
        .map((p) => [p.params.name, p.target.id]),
    ).toEqual([['Admin SW', 'n2']])
  })
})
