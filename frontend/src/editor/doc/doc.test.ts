import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  addNode,
  createDevice,
  createLink,
  deleteDevice,
  deleteLink,
  moveNodes,
  removeAnnotations,
  removeNodes,
  updateAnnotation,
  updateDevice,
} from './commands'
import { memoryDraftStore } from './drafts'
import { createDocStore, DOC_UNDO_LIMIT } from './store'
import { ANN, changesOf, type DiagramDetail } from './types'

const SITE = '66666666-6666-4666-8666-666666666666'
const FW = 'aaaaaaaa-0000-4000-8000-000000000001'
const SW = 'aaaaaaaa-0000-4000-8000-000000000002'
const LINK = 'bbbbbbbb-0000-4000-8000-000000000001'
const HIDDEN = 'cccccccc-0000-4000-8000-000000000001'

function detail(): DiagramDetail {
  return {
    diagram: {
      id: 'd1',
      name: 'LAN',
      layer: 'physical',
      description: '',
      nodeCount: 2,
      updatedAt: '2026-10-16T00:00:00Z',
      access: 'edit',
      version: 4,
    },
    view: {
      nodes: [
        { id: 'n-fw', refKind: 'device', refId: FW, x: 0, y: 0 },
        { id: 'n-h', refKind: 'device', refId: HIDDEN, x: 500, y: 0 },
      ],
      edges: [],
      annotations: [],
    },
    devices: [
      {
        id: FW,
        hostname: 'BD-FW01',
        type: 'firewall',
        siteId: SITE,
      } as DiagramDetail['devices'][number],
    ],
    endpointGroups: [],
    links: [],
    hiddenRefs: [HIDDEN],
  }
}

function loaded() {
  const s = createDocStore()
  s.getState().load(detail())
  return s
}

describe('diagram document store (P1-13)', () => {
  it('a new device and a link to it become ordered changes; temp ids are used by the view', () => {
    const s = loaded()
    s.getState().dispatch(
      createDevice({ hostname: 'BD-SW01', type: 'poe_switch', siteId: SITE }, 200, 0, SW),
    )
    s.getState().dispatch(
      createLink(
        { a: { kind: 'device', id: FW }, b: { kind: 'device', id: SW }, kind: 'ethernet' },
        LINK,
      ),
    )
    const req = s.getState().saveRequest()!
    expect(req.version).toBe(4)
    expect(req.changes!.map((c) => c.op)).toEqual(['createDevice', 'createLink'])
    // The node of an object deleted from the inventory (hidden ref) is dropped on load.
    expect(req.view.nodes.map((n) => n.refId)).toEqual([FW, SW])
    expect(req.view.edges).toEqual([{ id: expect.any(String), linkId: LINK }])
    expect(s.getState().status).toBe('dirty')
  })

  it('undo removes the pending change itself; redo brings it back', () => {
    const s = loaded()
    s.getState().dispatch(
      createDevice({ hostname: 'BD-SW01', type: 'poe_switch', siteId: SITE }, 200, 0, SW),
    )
    s.getState().undo()
    expect(changesOf(s.getState().doc!)).toEqual([])
    expect(s.getState().doc!.view.nodes).toHaveLength(1)
    s.getState().redo()
    expect(changesOf(s.getState().doc!)).toHaveLength(1)
  })

  it('a drag merges into one undo step; locked nodes do not move', () => {
    const s = loaded()
    for (let x = 1; x <= 30; x++)
      s.getState().dispatch(moveNodes([{ id: 'n-fw', x, y: 0 }], 'drag-1'))
    expect(s.getState().past).toHaveLength(1)
    expect(s.getState().doc!.view.nodes[0].x).toBe(30)
    s.getState().undo()
    expect(s.getState().doc!.view.nodes[0].x).toBe(0)
  })

  it(`keeps at least 100 undo steps (limit ${DOC_UNDO_LIMIT})`, () => {
    const s = loaded()
    for (let i = 0; i < 250; i++) s.getState().dispatch(moveNodes([{ id: 'n-fw', x: i, y: 0 }]))
    expect(s.getState().past.length).toBe(DOC_UNDO_LIMIT)
    for (let i = 0; i < 150; i++) s.getState().undo()
    expect(s.getState().doc!.view.nodes[0].x).toBe(99)
  })

  it('removing from the diagram is no inventory change; deleting from the inventory is', () => {
    const s = loaded()
    s.getState().dispatch(removeNodes(['n-fw']))
    expect(changesOf(s.getState().doc!)).toEqual([])
    s.getState().undo()
    s.getState().dispatch(deleteDevice(FW))
    expect(changesOf(s.getState().doc!)).toEqual([{ op: 'deleteDevice', id: FW }])
    expect(s.getState().doc!.view.nodes).toEqual([])
  })

  it('deleting a draft device drops its pending link instead of sending deletes', () => {
    const s = loaded()
    s.getState().dispatch(
      createDevice({ hostname: 'BD-SW01', type: 'poe_switch', siteId: SITE }, 0, 0, SW),
    )
    s.getState().dispatch(
      createLink(
        { a: { kind: 'device', id: FW }, b: { kind: 'device', id: SW }, kind: 'ethernet' },
        LINK,
      ),
    )
    s.getState().dispatch(deleteDevice(SW))
    expect(changesOf(s.getState().doc!)).toEqual([])
    expect(s.getState().doc!.view.edges).toEqual([])
  })

  it('editing a draft device edits its create; editing a saved one sends an update', () => {
    const s = loaded()
    s.getState().dispatch(
      createDevice({ hostname: 'BD-SW01', type: 'poe_switch', siteId: SITE }, 0, 0, SW),
    )
    s.getState().dispatch(
      updateDevice(SW, { hostname: 'BD-SW09', type: 'poe_switch', siteId: SITE, version: 0 }),
    )
    s.getState().dispatch(
      updateDevice(FW, { hostname: 'BD-FW02', type: 'firewall', siteId: SITE, version: 7 }),
    )
    expect(changesOf(s.getState().doc!)).toEqual([
      {
        op: 'createDevice',
        tempId: SW,
        device: { hostname: 'BD-SW09', type: 'poe_switch', siteId: SITE },
      },
      {
        op: 'updateDevice',
        id: FW,
        deviceUpdate: { hostname: 'BD-FW02', type: 'firewall', siteId: SITE, version: 7 },
      },
    ])
    expect(s.getState().doc!.devices[FW].hostname).toBe('BD-FW02')
  })

  it('adding a node draws known links to nodes already there; deleting a saved link is a change', () => {
    const d = detail()
    d.links = [
      {
        id: LINK,
        a: {
          kind: 'device',
          id: FW,
          name: 'BD-FW01',
          type: 'firewall',
          siteId: SITE,
          siteCode: '',
          interfaceId: null,
          interfaceName: '',
          interfaceKind: '',
          interfaceMedia: '',
          interfaceMode: '',
          accessVlan: null,
          nativeVlan: null,
          allowedVlans: '',
          lagId: null,
          lagName: '',
        },
        b: {
          kind: 'device',
          id: SW,
          name: 'BD-SW01',
          type: 'l2_switch',
          siteId: SITE,
          siteCode: '',
          interfaceId: null,
          interfaceName: '',
          interfaceKind: '',
          interfaceMedia: '',
          interfaceMode: '',
          accessVlan: null,
          nativeVlan: null,
          allowedVlans: '',
          lagId: null,
          lagName: '',
        },
        kind: 'ethernet',
        medium: '',
        speed: '',
        lengthM: null,
        cableId: '',
        status: 'up',
        provider: '',
        fiberMode: '',
        connector: '',
        service: '',
        circuitId: '',
        bandwidth: '',
        notes: '',
        access: 'edit',
        version: 1,
      },
    ]
    const s = createDocStore()
    s.getState().load(d)
    s.getState().dispatch(addNode('device', SW, 100, 100))
    expect(s.getState().doc!.view.edges.map((e) => e.linkId)).toEqual([LINK])
    s.getState().dispatch(deleteLink(LINK))
    expect(changesOf(s.getState().doc!)).toEqual([{ op: 'deleteLink', id: LINK }])
    expect(s.getState().doc!.view.edges).toEqual([])
  })

  it('links of the inventory between objects on the view are drawn on load', () => {
    const d = detail()
    d.view.nodes.push({ id: 'n-sw', refKind: 'device', refId: SW, x: 0, y: 200 })
    d.links = [
      {
        id: LINK,
        a: {
          kind: 'device',
          id: FW,
          name: '',
          type: 'firewall',
          siteId: SITE,
          siteCode: '',
          interfaceId: null,
          interfaceName: '',
          interfaceKind: '',
          interfaceMedia: '',
          interfaceMode: '',
          accessVlan: null,
          nativeVlan: null,
          allowedVlans: '',
          lagId: null,
          lagName: '',
        },
        b: {
          kind: 'device',
          id: SW,
          name: '',
          type: 'l2_switch',
          siteId: SITE,
          siteCode: '',
          interfaceId: null,
          interfaceName: '',
          interfaceKind: '',
          interfaceMedia: '',
          interfaceMode: '',
          accessVlan: null,
          nativeVlan: null,
          allowedVlans: '',
          lagId: null,
          lagName: '',
        },
        kind: 'fiber',
        medium: '',
        speed: '',
        lengthM: null,
        cableId: '',
        status: 'up',
        provider: '',
        fiberMode: '',
        connector: '',
        service: '',
        circuitId: '',
        bandwidth: '',
        notes: '',
        access: 'edit',
        version: 1,
      },
    ]
    const s = createDocStore()
    s.getState().load(d)
    expect(s.getState().doc!.view.edges).toEqual([{ id: `e-${LINK}`, linkId: LINK }])
    expect(s.getState().status).toBe('clean')
  })

  it('saving replaces the document and clears history', () => {
    const s = loaded()
    s.getState().dispatch(moveNodes([{ id: 'n-fw', x: 5, y: 5 }]))
    const d = detail()
    d.diagram.version = 5
    s.getState().saved(d)
    expect(s.getState().status).toBe('clean')
    expect(s.getState().past).toEqual([])
    expect(s.getState().meta!.version).toBe(5)
  })

  it('drafts round-trip through the store', async () => {
    const drafts = memoryDraftStore()
    const s = loaded()
    s.getState().dispatch(moveNodes([{ id: 'n-fw', x: 42, y: 0 }]))
    await drafts.put({ diagramId: 'd1', baseVersion: 4, doc: s.getState().doc!, savedAt: 'now' })
    const back = await drafts.get('d1')
    const fresh = loaded()
    fresh.getState().restore(back!.doc)
    expect(fresh.getState().doc!.view.nodes[0].x).toBe(42)
    expect(fresh.getState().status).toBe('dirty')
    await drafts.remove('d1')
    expect(await drafts.get('d1')).toBeUndefined()
  })

  it('a selected frame stays selected while it is resized, and leaves the selection when removed', () => {
    const s = loaded()
    s.getState().dispatch(
      addAnnotation({ id: 'z1', kind: 'zone', x: 0, y: 0, width: 200, height: 120 }),
    )
    s.getState().setSelection([ANN + 'z1', 'n-fw'])
    s.getState().dispatch(updateAnnotation('z1', { width: 320 }, 'resize:z1'))
    expect(s.getState().selection).toEqual([ANN + 'z1', 'n-fw'])
    s.getState().dispatch(removeAnnotations(['z1']))
    expect(s.getState().selection).toEqual(['n-fw'])
  })
})
