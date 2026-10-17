import { describe, expect, it } from 'vitest'
import { addAnnotation, moveAnnotation, removeAnnotations } from '../doc/commands'
import { createDocStore } from '../doc/store'
import type { DiagramDetail } from '../doc/types'
import { toAnnotationNodes } from './flow'
import {
  clusterBoxes,
  frameAt,
  nodesInFrame,
  rectAround,
  sharedSite,
  siteFrameMembers,
} from './frames'

const HCM = 'site-hcm'
const IDC = 'site-idc'
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const C = 'aaaaaaaa-0000-4000-8000-000000000003'

function loaded() {
  const s = createDocStore()
  s.getState().load({
    diagram: {
      id: 'd',
      name: 'D',
      layer: 'physical',
      description: '',
      nodeCount: 3,
      updatedAt: '',
      access: 'edit',
      version: 1,
    },
    view: {
      nodes: [
        { id: 'na', refKind: 'device', refId: A, x: 100, y: 100 },
        { id: 'nb', refKind: 'device', refId: B, x: 300, y: 100 },
        { id: 'nc', refKind: 'device', refId: C, x: 900, y: 600 },
      ],
      edges: [],
      annotations: [],
    },
    devices: [
      {
        id: A,
        hostname: 'FW1',
        type: 'firewall',
        siteId: IDC,
        clusterId: 'cl',
        clusterName: 'CJIDC-HA',
        clusterKind: 'ha_active_passive',
      },
      {
        id: B,
        hostname: 'FW2',
        type: 'firewall',
        siteId: IDC,
        clusterId: 'cl',
        clusterName: 'CJIDC-HA',
        clusterKind: 'ha_active_passive',
      },
      { id: C, hostname: 'SW1', type: 'l2_switch', siteId: HCM },
    ] as DiagramDetail['devices'],
    endpointGroups: [],
    links: [],
    hiddenRefs: [],
  })
  return s
}

describe('frames (P1-19, ADR-032)', () => {
  it('a frame around a selection is bound to the shared site; a mixed selection is not', () => {
    const doc = loaded().getState().doc!
    expect(rectAround(doc, ['na', 'nb'], {})).toEqual({ x: 76, y: 44, w: 392, h: 160 })
    expect(sharedSite(doc, ['na', 'nb'])).toBe(IDC)
    expect(sharedSite(doc, ['na', 'nc'])).toBeNull()
  })

  it('devices inside = node centre in the frame; the smallest site frame holds a point', () => {
    const s = loaded()
    s.getState().dispatch(
      addAnnotation({ id: 'big', kind: 'zone', x: 0, y: 0, width: 1200, height: 800, siteId: HCM }),
    )
    s.getState().dispatch(
      addAnnotation({
        id: 'small',
        kind: 'zone',
        x: 50,
        y: 50,
        width: 450,
        height: 200,
        siteId: IDC,
        locationId: 'room',
      }),
    )
    const doc = s.getState().doc!
    const small = doc.view.annotations[1]!
    expect(nodesInFrame(doc, small, {})).toEqual(['na', 'nb'])
    expect(frameAt(doc, 200, 120)?.id).toBe('small')
    expect(frameAt(doc, 900, 700)?.id).toBe('big')
    expect(frameAt(doc, 5000, 5000)).toBeNull()
  })

  it('moving a frame carries its devices in one undo step; removing it keeps them', () => {
    const s = loaded()
    s.getState().dispatch(
      addAnnotation({ id: 'f', kind: 'zone', x: 50, y: 50, width: 450, height: 200 }),
    )
    s.getState().dispatch(moveAnnotation('f', 60, 50, [{ id: 'na', x: 110, y: 100 }], 'drag:1'))
    s.getState().dispatch(moveAnnotation('f', 70, 50, [{ id: 'na', x: 120, y: 100 }], 'drag:1'))
    expect(s.getState().past).toHaveLength(2) // add + one merged drag
    expect(s.getState().doc!.view.nodes[0]!.x).toBe(120)
    s.getState().dispatch(removeAnnotations(['f']))
    expect(s.getState().doc!.view.annotations).toEqual([])
    expect(s.getState().doc!.view.nodes).toHaveLength(3)
  })

  it('draws frames under devices (title-only selection) and boxes clusters with two members on view', () => {
    const s = loaded()
    s.getState().dispatch(
      addAnnotation({ id: 'f', kind: 'zone', x: 0, y: 0, width: 300, height: 200 }),
    )
    s.getState().dispatch(addAnnotation({ id: 't', kind: 'text', x: 10, y: 10, text: 'IDC' }))
    const nodes = toAnnotationNodes(s.getState().doc!, new Set(['a:t']), true)
    expect(nodes.map((n) => [n.id, n.type, n.zIndex, n.selectable ?? true])).toEqual([
      ['a:f', 'frame', -1, false],
      ['a:t', 'text', 5, true],
    ])
    expect(nodes[1]!.selected).toBe(true)
    const boxes = clusterBoxes(s.getState().doc!, {})
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ clusterId: 'cl', name: 'CJIDC-HA', kind: 'ha_active_passive' })
  })

  it('site frames hold the devices of their site inside them (smallest frame wins)', () => {
    const s = loaded()
    s.getState().dispatch(
      addAnnotation({ id: 'idc', kind: 'zone', x: 0, y: 0, width: 600, height: 300, siteId: IDC }),
    )
    s.getState().dispatch(
      addAnnotation({ id: 'hcm', kind: 'zone', x: 0, y: 0, width: 1200, height: 800, siteId: HCM }),
    )
    const members = siteFrameMembers(s.getState().doc!, {})
    // FW1/FW2 sit in both frames but belong to IDC; SW1 (HCM) in the big HCM frame.
    expect(Object.fromEntries(members)).toEqual({ idc: ['na', 'nb'], hcm: ['nc'] })
  })
})
