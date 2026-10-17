import { describe, expect, it } from 'vitest'
import { createDevice, setLocked } from '../doc/commands'
import { createDocStore } from '../doc/store'
import type { DiagramDetail } from '../doc/types'
import { cloneInput, copySelection, mustClone, nextFreeHostname, planPaste } from './clipboard'

const SITE = '66666666-6666-4666-8666-666666666666'
const FW = 'aaaaaaaa-0000-4000-8000-000000000001'
const SW = 'aaaaaaaa-0000-4000-8000-000000000002'
const AP = 'aaaaaaaa-0000-4000-8000-000000000003'
const GRP = 'dddddddd-0000-4000-8000-000000000001'
const L1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const L2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const ORG = 'org-1'

const device = (id: string, hostname: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    hostname,
    type: 'l2_switch',
    siteId: SITE,
    locationId: null,
    vendor: 'Aruba',
    model: 'CX 6100',
    partNumber: 'JL677A',
    serialNumber: 'SN-123',
    assetTag: 'TS-9',
    firmware: '10.13',
    role: 'access',
    lifecycle: 'active',
    managed: true,
    tags: ['kho'],
    customFields: { cost_center: 'IT' },
    uHeight: 1,
    ownerName: 'IT',
    eolDate: null,
    eosDate: null,
    templateId: 'tpl-1',
    clusterId: 'cl-1',
    rackId: 'rk-1',
    rackU: 10,
    notes: 'gần cửa',
    ...extra,
  }) as unknown as DiagramDetail['devices'][number]
const link = (id: string, a: string, b: string) =>
  ({
    id,
    kind: 'fiber',
    medium: 'OM4',
    speed: '10G',
    fiberMode: 'mm',
    connector: 'LC',
    service: '',
    cableId: 'C-001',
    circuitId: 'X',
    provider: 'VNPT',
    a: { kind: 'device', id: a, interfaceName: 'Te1' },
    b: { kind: 'device', id: b, interfaceName: 'Te2' },
  }) as unknown as DiagramDetail['links'][number]

function loaded() {
  const s = createDocStore()
  s.getState().load({
    diagram: {
      id: 'd1',
      name: 'LAN',
      layer: 'physical',
      description: '',
      nodeCount: 3,
      updatedAt: '2026-10-17T00:00:00Z',
      access: 'edit',
      version: 1,
    },
    view: {
      nodes: [
        { id: 'n-fw', refKind: 'device', refId: FW, x: 100, y: 100 },
        { id: 'n-sw', refKind: 'device', refId: SW, x: 300, y: 100 },
        { id: 'n-ap', refKind: 'device', refId: AP, x: 500, y: 100 },
        { id: 'n-g', refKind: 'endpoint_group', refId: GRP, x: 300, y: 300 },
      ],
      edges: [],
      annotations: [],
    },
    devices: [device(FW, 'BD01-FW01'), device(SW, 'BD01-SW01'), device(AP, 'BD01-AP01')],
    endpointGroups: [{ id: GRP, name: 'CAM', kind: 'ip_camera' } as never],
    links: [link(L1, FW, SW), link(L2, SW, AP)],
    hiddenRefs: [],
  })
  return s
}

describe('copy / paste / duplicate (P1-16)', () => {
  it('copies the selection with its inner cables only, relative to its top-left', () => {
    const doc = loaded().getState().doc!
    const c = copySelection(doc, ['n-fw', 'n-sw', 'n-g'], ORG)!
    expect(c).toMatchObject({ orgId: ORG, x: 100, y: 100 })
    expect(c.nodes.map((n) => [n.refId, n.dx, n.dy])).toEqual([
      [FW, 0, 0],
      [SW, 200, 0],
      [GRP, 200, 200],
    ])
    expect(c.links.map((l) => l.id)).toEqual([L1])
    expect(copySelection(doc, [], ORG)).toBeNull()
  })

  it('clones when anything copied is already drawn here; places on another diagram', () => {
    const s = loaded()
    const c = copySelection(s.getState().doc!, ['n-fw'], ORG)!
    expect(mustClone(s.getState().doc!, c, false)).toBe(true)
    expect(
      mustClone({ ...s.getState().doc!, view: { ...s.getState().doc!.view, nodes: [] } }, c, false),
    ).toBe(false)
    expect(
      mustClone({ ...s.getState().doc!, view: { ...s.getState().doc!.view, nodes: [] } }, c, true),
    ).toBe(true)
  })

  it('a clone keeps the model, never the identity; it is planned', () => {
    const input = cloneInput(device(FW, 'BD01-FW01') as never, 'BD01-FW02')
    expect(input).toMatchObject({
      hostname: 'BD01-FW02',
      vendor: 'Aruba',
      model: 'CX 6100',
      firmware: '10.13',
      lifecycle: 'planned',
      templateId: 'tpl-1',
      customFields: { cost_center: 'IT' },
    })
    for (const k of [
      'serialNumber',
      'assetTag',
      'clusterId',
      'rackId',
      'rackU',
      'notes',
      'mgmtInterfaceId',
    ])
      expect(input).not.toHaveProperty(k)
  })

  it('renames with the next free number, case-insensitively', () => {
    expect(nextFreeHostname('BD01-SW01', new Set(['bd01-sw02', 'BD01-SW03']))).toBe('BD01-SW04')
    expect(nextFreeHostname('CORE', new Set(['CORE-02']))).toBe('CORE-03')
    expect(nextFreeHostname('X'.repeat(70), new Set()).length).toBeLessThanOrEqual(63)
  })

  it('duplicate: new devices, inner cables cloned without IDs of the physical cable, groups skipped', () => {
    const s = loaded()
    const doc = s.getState().doc!
    const c = copySelection(doc, ['n-fw', 'n-sw', 'n-g'], ORG)!
    const plan = planPaste(
      doc,
      c,
      { x: 140, y: 140 },
      {
        clone: true,
        sources: { [FW]: device(FW, 'BD01-FW01') as never, [SW]: device(SW, 'BD01-SW01') as never },
        links: [link(L1, FW, SW), link(L2, SW, AP)] as never,
        taken: new Set(['BD01-FW01', 'BD01-SW01', 'BD01-SW02']),
      },
    )
    expect(plan).toMatchObject({ cloned: 2, skippedGroups: 1 })
    s.getState().dispatch(plan.command)
    const after = s.getState().doc!
    expect(after.newDeviceOrder.map((id) => after.newDevices[id]!.hostname)).toEqual([
      'BD01-FW02',
      'BD01-SW03',
    ])
    const newLinks = after.newLinkOrder.map((id) => after.newLinks[id]!)
    expect(newLinks).toEqual([
      expect.objectContaining({
        kind: 'fiber',
        medium: 'OM4',
        fiberMode: 'mm',
        connector: 'LC',
        status: 'planned',
      }),
    ])
    expect(newLinks[0]).not.toHaveProperty('cableId')
    // One undo step for the whole paste.
    s.getState().undo()
    expect(s.getState().doc!.newDeviceOrder).toEqual([])
    expect(plan.nodeIds).toHaveLength(2)
  })

  it('paste on another diagram places the same objects with their inventory cables', () => {
    const src = loaded().getState().doc!
    const c = copySelection(src, ['n-fw', 'n-sw'], ORG)!
    const target = loaded()
    target.getState().dispatch({
      label: 'clear',
      apply(d) {
        d.view.nodes = []
        d.view.edges = []
        d.links = {}
      },
    })
    const plan = planPaste(
      target.getState().doc!,
      c,
      { x: c.x, y: c.y },
      {
        clone: false,
        sources: {},
        links: [link(L1, FW, SW)] as never,
        taken: new Set(),
      },
    )
    target.getState().dispatch(plan.command)
    const d = target.getState().doc!
    expect(d.view.nodes.map((n) => [n.refId, n.x])).toEqual([
      [FW, 100],
      [SW, 300],
    ])
    expect(d.view.edges.map((e) => e.linkId)).toEqual([L1])
    expect(d.newDeviceOrder).toEqual([])
  })

  it('a pending device can only be cloned; a provider cloud keeps its name', () => {
    const s = loaded()
    s.getState().dispatch(
      createDevice(
        { hostname: 'Internet', type: 'provider_cloud', siteId: SITE },
        0,
        0,
        'tmp-1',
        'n-tmp',
      ),
    )
    const doc = s.getState().doc!
    const c = copySelection(doc, ['n-tmp'], ORG)!
    expect(mustClone({ ...doc, view: { ...doc.view, nodes: [] } }, c, false)).toBe(true)
    const plan = planPaste(
      doc,
      c,
      { x: 40, y: 40 },
      {
        clone: true,
        sources: {},
        links: [],
        taken: new Set(['Internet']),
      },
    )
    s.getState().dispatch(plan.command)
    const after = s.getState().doc!
    expect(after.newDeviceOrder.map((id) => after.newDevices[id]!.hostname)).toEqual([
      'Internet',
      'Internet',
    ])
  })
})

describe('lock and saving (P1-16)', () => {
  it('locks and unlocks as one step each', () => {
    const s = loaded()
    s.getState().dispatch(setLocked(['n-fw', 'n-sw'], true))
    expect(
      s
        .getState()
        .doc!.view.nodes.filter((n) => n.locked)
        .map((n) => n.id),
    ).toEqual(['n-fw', 'n-sw'])
    s.getState().dispatch(setLocked(['n-fw'], false))
    expect(s.getState().doc!.view.nodes[0]).not.toHaveProperty('locked')
    expect(s.getState().past).toHaveLength(2)
  })

  it('edits wait while a save is on its way (its answer replaces the document)', () => {
    const s = loaded()
    s.getState().setStatus('saving')
    s.getState().dispatch(setLocked(['n-fw'], true))
    expect(s.getState().past).toHaveLength(0)
  })
})
