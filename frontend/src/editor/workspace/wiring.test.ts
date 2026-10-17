import { describe, expect, it } from 'vitest'
import { createDevice, createLink, deleteLink } from '../doc/commands'
import { createDocStore } from '../doc/store'
import { changesOf, type DiagramDetail } from '../doc/types'
import { expandTemplatePorts } from '../library/ports'
import { borderPoint, parallelOffset, toFlowEdges } from './flow'
import { shortPort, sortPorts, suggestKind, takenPorts, portRanges } from './wiring'

const SITE = '66666666-6666-4666-8666-666666666666'
const FW = 'aaaaaaaa-0000-4000-8000-000000000001'
const SW = 'aaaaaaaa-0000-4000-8000-000000000002'

function loaded() {
  const s = createDocStore()
  s.getState().load({
    diagram: {
      id: 'd1',
      name: 'LAN',
      layer: 'physical',
      description: '',
      nodeCount: 2,
      updatedAt: '2026-10-17T00:00:00Z',
      access: 'edit',
      version: 1,
    },
    view: {
      nodes: [
        { id: 'n-fw', refKind: 'device', refId: FW, x: 0, y: 0 },
        { id: 'n-sw', refKind: 'device', refId: SW, x: 300, y: 0 },
      ],
      edges: [],
      annotations: [],
    },
    devices: [
      { id: FW, hostname: 'FW01', type: 'firewall', siteId: SITE },
      { id: SW, hostname: 'SW01', type: 'l2_switch', siteId: SITE },
    ] as DiagramDetail['devices'],
    endpointGroups: [],
    links: [],
    hiddenRefs: [],
  })
  return s
}

describe('cable kind suggestion (P1-17)', () => {
  it('follows port media first, then device types', () => {
    expect(suggestKind('firewall', 'l2_switch')).toBe('ethernet')
    expect(suggestKind('l3_switch', 'l3_switch', 'SFP+', 'SFP+')).toBe('fiber')
    expect(suggestKind('ups', 'server')).toBe('power')
    expect(suggestKind('ups', 'l2_switch', 'RJ45', 'RJ45')).toBe('ethernet')
    expect(suggestKind('modem', 'provider_cloud')).toBe('dsl')
    expect(suggestKind('ont', 'provider_cloud')).toBe('fiber')
    expect(suggestKind('wireless_bridge', 'wireless_bridge')).toBe('wireless')
    expect(suggestKind('access_point', '')).toBe('wireless')
    expect(suggestKind('olt', 'ont', 'PON')).toBe('fiber')
    expect(suggestKind('l2_switch', 'l2_switch', '', '', true)).toBe('stack')
    expect(suggestKind('router', 'console_server')).toBe('console')
  })
})

describe('ports (P1-17)', () => {
  it('sorts physical first and numbers naturally; labels use short names', () => {
    const ports = [
      { name: 'Vlan10', kind: 'svi' },
      { name: 'Gi1/0/10', kind: 'physical' },
      { name: 'Gi1/0/2', kind: 'physical' },
    ]
    expect(sortPorts(ports).map((p) => p.name)).toEqual(['Gi1/0/2', 'Gi1/0/10', 'Vlan10'])
    expect(shortPort('GigabitEthernet1/0/1')).toBe('Gi1/0/1')
    expect(shortPort('TenGigabitEthernet1/1/1')).toBe('Te1/1/1')
    expect(shortPort('Ethernet1/1')).toBe('Eth1/1')
    expect(shortPort('wan1')).toBe('wan1')
  })

  it('expands template ports like the server, with temp ids', () => {
    const ports = expandTemplatePorts([
      { pattern: 'Gi{m}/0/{n}', start: 1, count: 3, media: 'RJ45', speed: '1G', poe: true },
      { pattern: 'mgmt', start: 1, count: 1 },
    ])
    expect(ports.map((p) => [p.name, p.media])).toEqual([
      ['Gi1/0/1', 'RJ45'],
      ['Gi1/0/2', 'RJ45'],
      ['Gi1/0/3', 'RJ45'],
      ['mgmt', ''],
    ])
    expect(new Set(ports.map((p) => p.id)).size).toBe(4)
  })

  it('a port is taken by saved cables unless deleted here, and by cables drawn here', () => {
    const s = loaded()
    const saved = [
      {
        id: 'l-old',
        kind: 'ethernet',
        a: { kind: 'device', id: FW, interfaceId: 'p1', name: 'FW01' },
        b: { kind: 'device', id: SW, interfaceId: 's1', name: 'SW01' },
      },
      {
        id: 'l-radio',
        kind: 'wireless',
        a: { kind: 'device', id: FW, interfaceId: 'r1', name: 'FW01' },
        b: { kind: 'device', id: SW, interfaceId: null, name: 'SW01' },
      },
    ] as never
    expect([...takenPorts(s.getState().doc!, FW, saved)]).toEqual([['p1', 'SW01']])
    s.getState().dispatch(deleteLink('l-old'))
    s.getState().dispatch(
      createLink({
        a: { kind: 'device', id: FW, interfaceId: 'p2' },
        b: { kind: 'device', id: SW },
        kind: 'fiber',
      }),
    )
    expect([...takenPorts(s.getState().doc!, FW, saved)]).toEqual([['p2', 'SW01']])
  })
})

describe('cables on the canvas (P1-17)', () => {
  it('meet the node border and spread when parallel', () => {
    const rect = { x: 0, y: 0, w: 100, h: 50 }
    expect(borderPoint(rect, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(borderPoint(rect, { x: 50, y: 300 })).toEqual({ x: 50, y: 50 })
    expect([0, 1, 2].map((i) => parallelOffset(i, 3))).toEqual([-14, 0, 14])
    const s = loaded()
    s.getState().dispatch(
      createLink(
        { a: { kind: 'device', id: FW }, b: { kind: 'device', id: SW }, kind: 'ethernet' },
        'l1',
        { aPort: 'port1', bPort: 'GigabitEthernet1/0/1' },
      ),
    )
    s.getState().dispatch(
      createLink({ a: { kind: 'device', id: SW }, b: { kind: 'device', id: FW }, kind: 'fiber' }),
    )
    const edges = toFlowEdges(s.getState().doc!)
    expect(edges.map((e) => [e.type, e.data!.index, e.data!.count])).toEqual([
      ['cable', 0, 2],
      ['cable', 1, 2],
    ])
    expect(edges[0]!.data).toMatchObject({
      aPort: 'port1',
      bPort: 'GigabitEthernet1/0/1',
      status: 'up',
    })
    s.getState().dispatch(
      createLink(
        {
          a: { kind: 'device', id: FW },
          b: { kind: 'device', id: SW },
          kind: 'ethernet',
          status: 'down',
        },
        'l3',
      ),
    )
    const down = toFlowEdges(s.getState().doc!).find((e) => e.data!.linkId === 'l3')!
    expect(down.className).toContain('ntb-link-down')
    expect(down.data!.status).toBe('down')
  })

  it('a new device sends its template port temp ids so cables drawn before saving keep their ports', () => {
    const s = loaded()
    const ports = expandTemplatePorts([{ pattern: 'Gi1/0/{n}', start: 1, count: 2 }])
    s.getState().dispatch(
      createDevice(
        { hostname: 'SW02', type: 'l2_switch', siteId: SITE, templateId: 'tpl-1' },
        0,
        0,
        'tmp-sw',
        'n-tmp',
        ports,
      ),
    )
    expect(changesOf(s.getState().doc!)[0]).toMatchObject({
      op: 'createDevice',
      tempId: 'tmp-sw',
      portTempIds: [
        { name: 'Gi1/0/1', tempId: ports[0]!.id },
        { name: 'Gi1/0/2', tempId: ports[1]!.id },
      ],
    })
  })
})

describe('portRanges', () => {
  it('compresses consecutive port numbers', () => {
    expect(portRanges(['Gi1/0/3', 'Gi1/0/1', 'Gi1/0/2', 'Gi1/0/7'])).toBe('Gi1/0/1–3, Gi1/0/7')
    expect(portRanges(['port1', 'port2', 'wan1'])).toBe('port1–2, wan1')
    expect(portRanges(['console'])).toBe('console')
  })
})

describe('endpoint groups on the diagram (ADR-036)', () => {
  it('a drawn group, edited, cabled to a port range: one edge, one cable per port, saved in order', async () => {
    const { createGroup, updateGroup, compound } = await import('../doc/commands')
    const s = loaded()
    const G = 'bbbbbbbb-0000-4000-8000-000000000001'
    s.getState().dispatch(
      createGroup(
        { kind: 'ip_camera', name: 'Camera', siteId: SITE, expectedCount: 24 },
        0,
        300,
        G,
        'n-cam',
      ),
    )
    s.getState().dispatch(
      updateGroup(
        G,
        { kind: 'ip_camera', name: 'Camera tầng 1', siteId: SITE, expectedCount: 24 },
        0,
        '',
      ),
    )
    const cable = (port: string, name: string) =>
      createLink(
        {
          a: { kind: 'device', id: SW, interfaceId: port },
          b: { kind: 'endpoint_group', id: G },
          kind: 'ethernet',
        },
        port.replace('p', 'aaaaaaaa-1111-4000-8000-00000000000'),
        { aPort: name, bPort: '' },
      )
    s.getState().dispatch(
      compound('createLinks', [
        cable('p1', 'Gi1/0/1'),
        cable('p2', 'Gi1/0/2'),
        cable('p3', 'Gi1/0/3'),
      ]),
    )
    const doc = s.getState().doc!
    const edges = toFlowEdges(doc).filter((e) => e.target === 'n-cam' || e.source === 'n-cam')
    expect(edges).toHaveLength(1)
    expect(edges[0]!.data!.aPort).toBe('Gi1/0/1–3 (3)')
    expect(edges[0]!.data!.bundle).toHaveLength(3)
    const ops = changesOf(doc).map((c) => c.op)
    expect(ops).toEqual(['createEndpointGroup', 'createLink', 'createLink', 'createLink'])
    expect(changesOf(doc)[0]!.endpointGroup).toMatchObject({
      name: 'Camera tầng 1',
      expectedCount: 24,
    })
    // One undo removes all three cables.
    s.getState().undo()
    expect(toFlowEdges(s.getState().doc!)).toHaveLength(0)
  })
})

describe('portLabel', () => {
  it('compact by default, Cisco or full on request; other vendors untouched', async () => {
    const { portLabel } = await import('./wiring')
    expect(portLabel('GigabitEthernet1/0/24')).toBe('g1/0/24')
    expect(portLabel('Gi1/0/24')).toBe('g1/0/24')
    expect(portLabel('TenGigabitEthernet1/1/1')).toBe('te1/1/1')
    expect(portLabel('Port-channel1')).toBe('po1')
    expect(portLabel('GigabitEthernet1/0/24', 'cisco')).toBe('Gi1/0/24')
    expect(portLabel('GigabitEthernet1/0/24', 'full')).toBe('GigabitEthernet1/0/24')
    expect(portLabel('GigabitEthernet1/0/1–10, GigabitEthernet1/0/12 (11)')).toBe(
      'g1/0/1–10, g1/0/12 (11)',
    )
    for (const other of ['wan1', 'port1', 'ether1', 'ge-0/0/1', 'internal3', 'GE5'])
      expect(portLabel(other)).toBe(other)
  })
})
