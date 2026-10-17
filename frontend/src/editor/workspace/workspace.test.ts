import { describe, expect, it } from 'vitest'
import { addNode, createLink, moveNodes, removeNodes } from '../doc/commands'
import { defaultSiteFor } from '../library/placement'
import { createDocStore } from '../doc/store'
import type { DiagramDetail } from '../doc/types'
import { toFlowEdges, toFlowNodes } from './flow'
import { actionFor, isTyping, keysLabel, SHORTCUTS } from './shortcuts'

const SITE = '66666666-6666-4666-8666-666666666666'
const FW = 'aaaaaaaa-0000-4000-8000-000000000001'
const SW = 'aaaaaaaa-0000-4000-8000-000000000002'
const AP = 'aaaaaaaa-0000-4000-8000-000000000003'
const L1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const L2 = 'bbbbbbbb-0000-4000-8000-000000000002'

function detail(): DiagramDetail {
  const dev = (id: string, hostname: string) =>
    ({ id, hostname, type: 'firewall', siteId: SITE }) as DiagramDetail['devices'][number]
  const link = (id: string, a: string, b: string, kind: string) =>
    ({
      id,
      kind,
      a: { kind: 'device', id: a, interfaceName: '' },
      b: { kind: 'device', id: b, interfaceName: '' },
    }) as unknown as DiagramDetail['links'][number]
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
        { id: 'n-sw', refKind: 'device', refId: SW, x: 200, y: 0, locked: true },
      ],
      edges: [{ id: 'e1', linkId: L1, routing: 'orthogonal' }],
      annotations: [],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    },
    devices: [dev(FW, 'FW01'), dev(SW, 'SW01'), dev(AP, 'AP01')],
    endpointGroups: [],
    // L2 ends on a device that is not drawn: no edge.
    links: [link(L1, FW, SW, 'fiber'), link(L2, SW, AP, 'logical')],
    hiddenRefs: [],
  }
}

function loaded() {
  const s = createDocStore()
  s.getState().load(detail())
  return s
}

describe('document → React Flow (P1-14)', () => {
  it('nodes carry references, selection and lock; edges join the view nodes of both link ends', () => {
    const doc = loaded().getState().doc!
    const nodes = toFlowNodes(doc, new Set(['n-sw']))
    expect(nodes.map((n) => [n.id, n.type, n.selected, n.draggable])).toEqual([
      ['n-fw', 'device', false, true],
      ['n-sw', 'device', true, false],
    ])
    expect(nodes[0]!.data).toEqual({ refKind: 'device', refId: FW, locked: false, labelColor: '' })
    const edges = toFlowEdges(doc)
    expect(edges).toEqual([
      expect.objectContaining({
        id: 'e1',
        source: 'n-fw',
        target: 'n-sw',
        type: 'cable',
        className: 'ntb-edge-fiber',
      }),
    ])
  })

  it('a link drawn in the editor is styled as pending', () => {
    const s = loaded()
    s.getState().dispatch(
      createLink({ a: { kind: 'device', id: FW }, b: { kind: 'device', id: SW }, kind: 'logical' }),
    )
    const edges = toFlowEdges(s.getState().doc!)
    expect(edges.at(-1)).toMatchObject({
      type: 'cable',
      className: 'ntb-edge-logical ntb-edge-draft',
    })
  })
})

describe('editor state outside the history (P1-14)', () => {
  it('viewport is saved with the view but panning is neither a change nor an undo step', () => {
    const s = loaded()
    expect(s.getState().viewport).toEqual({ x: 10, y: 20, zoom: 0.8 })
    s.getState().setViewport({ x: -50, y: 0, zoom: 2 })
    expect(s.getState().status).toBe('clean')
    expect(s.getState().past).toHaveLength(0)
    expect(s.getState().saveRequest()!.view.viewport).toEqual({ x: -50, y: 0, zoom: 2 })
  })

  it('selection survives undo; one drag is one undo step; locked nodes stay put', () => {
    const s = loaded()
    s.getState().setSelection(['n-fw'])
    s.getState().dispatch(moveNodes([{ id: 'n-fw', x: 10, y: 0 }], 'drag:1'))
    s.getState().dispatch(moveNodes([{ id: 'n-fw', x: 20, y: 0 }], 'drag:1'))
    s.getState().dispatch(moveNodes([{ id: 'n-sw', x: 999, y: 999 }], 'drag:2'))
    expect(s.getState().past).toHaveLength(1)
    expect(s.getState().doc!.view.nodes.find((n) => n.id === 'n-sw')).toMatchObject({ x: 200 })
    s.getState().undo()
    expect(s.getState().doc!.view.nodes[0]).toMatchObject({ x: 0 })
    expect(s.getState().selection).toEqual(['n-fw'])
  })
})

describe('editor shortcuts (SRS §6.4)', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })
  it('maps keys to actions, Cmd like Ctrl, Shift+digit by physical key', () => {
    expect(actionFor(key('z', { ctrlKey: true }))).toBe('undo')
    expect(actionFor(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo')
    expect(actionFor(key('y', { ctrlKey: true }))).toBe('redo')
    expect(actionFor(key('s', { metaKey: true }))).toBe('save')
    expect(actionFor(key('!', { shiftKey: true, code: 'Digit1' }))).toBe('fit')
    expect(actionFor(key(')', { shiftKey: true, code: 'Digit0' }))).toBe('zoomReset')
    expect(actionFor(key('Delete'))).toBe('remove')
    expect(actionFor(key('?', { shiftKey: true }))).toBe('help')
    expect(actionFor(key('/', { shiftKey: true, code: 'Slash' }))).toBe('help')
    expect(actionFor(key('Backspace'))).toBe('remove')
    expect(actionFor(key('Delete', { shiftKey: true }))).toBe('deleteInventory')
    expect(actionFor(key('d', { ctrlKey: true }))).toBe('duplicate')
    expect(actionFor(key('l', { ctrlKey: true }))).toBeNull()
    expect(actionFor(key('L', { ctrlKey: true, shiftKey: true }))).toBe('lock')
    expect(actionFor(key('/'))).toBe('quickAdd')
    expect(actionFor(key('b'))).toBe('library')
    expect(actionFor(key('1'))).toBeNull()
    expect(actionFor(key('s', { ctrlKey: true, altKey: true }))).toBeNull()
  })
  it('shows ⌘ instead of Ctrl on macOS', () => {
    expect(keysLabel('redo', true)).toBe('⌘+Shift+Z')
    expect(keysLabel('redo', false)).toBe('Ctrl+Shift+Z')
  })
  it('every shortcut has keys; typing in a field is not a shortcut', () => {
    expect(SHORTCUTS.every((s) => s.keys.length > 0)).toBe(true)
    const input = document.createElement('input')
    expect(isTyping(input)).toBe(true)
    expect(isTyping(document.createElement('div'))).toBe(false)
  })
})

describe('P1-14 review fixes', () => {
  it('undoing back to the saved document is clean again; selection drops removed nodes', () => {
    const s = loaded()
    s.getState().dispatch(
      addNode('device', AP, 400, 0, {
        id: 'n-ap',
        device: { id: AP, hostname: 'AP01', type: 'access_point', siteId: SITE },
      }),
    )
    s.getState().setSelection(['n-ap', 'n-fw'])
    expect(s.getState().status).toBe('dirty')
    s.getState().undo()
    expect(s.getState().status).toBe('clean')
    expect(s.getState().selection).toEqual(['n-fw'])
    s.getState().redo()
    expect(s.getState().status).toBe('dirty')
  })

  it('Delete keeps locked nodes; a move to the same place is not an undo step', () => {
    const s = loaded()
    s.getState().dispatch(removeNodes(['n-sw']))
    expect(s.getState().past).toHaveLength(0)
    s.getState().dispatch(moveNodes([{ id: 'n-fw', x: 0, y: 0 }]))
    expect(s.getState().past).toHaveLength(0)
  })

  it('offers the one site the diagram shows, else the last used one', () => {
    const doc = loaded().getState().doc!
    expect(defaultSiteFor(doc, null)).toBe(SITE)
    const mixed = {
      ...doc,
      devices: { ...doc.devices, [SW]: { ...doc.devices[SW]!, siteId: 'other-site' } },
    }
    expect(defaultSiteFor(mixed, null)).toBeNull()
    expect(defaultSiteFor(mixed, 'last')).toBe('last')
  })
})
