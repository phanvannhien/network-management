import { describe, expect, it } from 'vitest'
import { addAnnotation, addNode, createDevice, createLink, removeNodes } from './commands'
import { addPage, duplicatePage, movePage, removePage, sendToPage } from './pageCommands'
import { docOnPage, pageOf, pagesOf, pagesOfRefs } from './pages'
import { createDocStore } from './store'
import type { DiagramDetail } from './types'

// P2-08 (ADR-047): pages of one diagram — one document, one history; edges follow their ends per page.

const SITE = '66666666-6666-4666-8666-666666666666'
const CORE = 'aaaaaaaa-0000-4000-8000-000000000001'
const ACC = 'aaaaaaaa-0000-4000-8000-000000000002'
const LINK = 'bbbbbbbb-0000-4000-8000-000000000001'

function loaded() {
  const s = createDocStore()
  const detail: DiagramDetail = {
    diagram: {
      id: 'd1',
      name: 'HQ',
      layer: 'physical',
      description: '',
      nodeCount: 1,
      updatedAt: '2026-10-18T00:00:00Z',
      access: 'edit',
      version: 1,
    },
    view: {
      nodes: [{ id: 'n-core', refKind: 'device', refId: CORE, x: 0, y: 0 }],
      edges: [],
      annotations: [],
    },
    devices: [
      {
        id: CORE,
        hostname: 'CORE',
        type: 'l3_switch',
        siteId: SITE,
      } as DiagramDetail['devices'][number],
    ],
    endpointGroups: [],
    links: [],
    hiddenRefs: [],
  }
  s.getState().load(detail)
  return s
}

const edgesOn = (s: ReturnType<typeof loaded>, page: string) =>
  docOnPage(s.getState().doc!, page).view.edges.map((e) => e.linkId)

describe('pages', () => {
  it('a diagram without pages is one page; the second page names the first and pages every item', () => {
    const s = loaded()
    expect(pagesOf(s.getState().doc!.view, 'physical')).toEqual([
      { id: 'p1', name: '', layer: 'physical' },
    ])
    s.getState().dispatch(addPage('p2', 'Tầng 2', 'physical', 'Phòng server', 'physical'))
    const v = s.getState().doc!.view
    expect(v.pages!.map((p) => p.name)).toEqual(['Phòng server', 'Tầng 2'])
    expect(v.nodes[0]!.pageId).toBe('p1')
    // One undo step back to a page-less diagram.
    s.getState().undo()
    expect(s.getState().doc!.view.pages).toBeUndefined()
  })

  it('places new things on the page being edited; one object once per page, on several pages', () => {
    const s = loaded()
    s.getState().dispatch(addPage('p2', 'Tầng 2', 'physical', 'Phòng server', 'physical'))
    s.getState().setPage('p2')
    s.getState().dispatch(
      createDevice({ hostname: 'ACC', type: 'poe_switch', siteId: SITE }, 200, 0, ACC),
    )
    s.getState().dispatch(addNode('device', CORE, 0, 0, { id: 'n-core-2' }))
    s.getState().dispatch(addNode('device', CORE, 50, 0, { id: 'n-core-3' }))
    s.getState().dispatch(addAnnotation({ id: 't1', kind: 'text', x: 0, y: 0, text: 'Tầng 2' }))
    const v = s.getState().doc!.view
    expect(v.nodes.filter((n) => n.refId === CORE).map((n) => pageOf(v, n))).toEqual(['p1', 'p2'])
    expect(v.nodes.find((n) => n.refId === ACC)!.pageId).toBe('p2')
    expect(v.annotations[0]!.pageId).toBe('p2')
    expect(pagesOfRefs(v).get(CORE)).toEqual(['p1', 'p2'])

    // A cable drawn on page 2 is drawn there only; placing ACC on page 1 draws it there too.
    s.getState().dispatch(
      createLink(
        { a: { kind: 'device', id: CORE }, b: { kind: 'device', id: ACC }, kind: 'fiber' },
        LINK,
      ),
    )
    expect(edgesOn(s, 'p2')).toEqual([LINK])
    expect(edgesOn(s, 'p1')).toEqual([])
    s.getState().setPage('p1')
    s.getState().dispatch(addNode('device', ACC, 200, 0))
    expect(edgesOn(s, 'p1')).toEqual([LINK])
    // Taking CORE off page 1 drops the cable there, not on page 2.
    s.getState().dispatch(removeNodes(['n-core']))
    expect(edgesOn(s, 'p1')).toEqual([])
    expect(edgesOn(s, 'p2')).toEqual([LINK])
  })

  it('moves, copies, duplicates, reorders and removes pages; undo shows the page it changed', () => {
    const s = loaded()
    s.getState().dispatch(addPage('p2', 'Tầng 2', 'l2', 'Phòng server', 'physical'))
    // Move the core to page 2, then undo from page 1: the editor jumps to page 2.
    s.getState().dispatch(sendToPage(['n-core'], [], 'p2', false))
    expect(s.getState().doc!.view.nodes[0]!.pageId).toBe('p2')
    s.getState().setPage('p2')
    expect(s.getState().lens).toBe('l2') // an L2 page opens in the L2 view
    s.getState().dispatch(sendToPage(['n-core'], [], 'p1', true))
    expect(
      s
        .getState()
        .doc!.view.nodes.map((n) => n.pageId)
        .sort(),
    ).toEqual(['p1', 'p2'])
    s.getState().setPage('p1')
    s.getState().undo()
    expect(s.getState().page).toBe('p1') // the removed copy was on page 1
    s.getState().undo()
    expect(s.getState().doc!.view.nodes[0]!.pageId).toBe('p1')

    s.getState().dispatch(duplicatePage('p1', 'p3', 'Phòng server (bản sao)', 'Phòng server'))
    const v = s.getState().doc!.view
    expect(v.pages!.map((p) => p.id)).toEqual(['p1', 'p3', 'p2'])
    expect(v.nodes.filter((n) => n.pageId === 'p3')).toHaveLength(1)
    s.getState().dispatch(movePage('p2', -1))
    expect(s.getState().doc!.view.pages!.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    s.getState().setPage('p3')
    s.getState().dispatch(removePage('p3'))
    expect(s.getState().doc!.view.pages!.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.getState().page).toBe('p1') // the page being edited is gone
    expect(s.getState().doc!.view.nodes.every((n) => n.pageId !== 'p3')).toBe(true)
    // The last page cannot go.
    s.getState().dispatch(removePage('p2'))
    s.getState().dispatch(removePage('p1'))
    expect(s.getState().doc!.view.pages).toHaveLength(1)
  })

  it('saves the first page viewport only', () => {
    const s = loaded()
    s.getState().dispatch(addPage('p2', 'Tầng 2', 'physical', 'Phòng server', 'physical'))
    s.getState().setPage('p2')
    s.getState().setViewport({ x: 5, y: 5, zoom: 2 })
    // Page 2's view is remembered per browser; the saved one stays the first page's.
    expect(s.getState().saveRequest()!.view.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    s.getState().setPage('p1')
    s.getState().setViewport({ x: 1, y: 1, zoom: 1 })
    expect(s.getState().saveRequest()!.view.viewport).toEqual({ x: 1, y: 1, zoom: 1 })
  })
})

describe('off-page connectors', () => {
  it('names where each cable continues, groups per node and target, keeps a moved connector', async () => {
    const { offPageConnectors } = await import('./offpage')
    const { setStub } = await import('./pageCommands')
    const s = loaded()
    s.getState().dispatch(addPage('p2', 'Tầng 2', 'physical', 'Phòng server', 'physical'))
    s.getState().setPage('p2')
    s.getState().dispatch(
      createDevice({ hostname: 'ACC', type: 'poe_switch', siteId: SITE }, 200, 0, ACC),
    )
    const link = (id: string, a: string, b: string) =>
      createLink({ a: { kind: 'device', id: a }, b: { kind: 'device', id: b }, kind: 'fiber' }, id)
    s.getState().dispatch(link(LINK, CORE, ACC))
    s.getState().dispatch(link('bbbbbbbb-0000-4000-8000-000000000002', CORE, ACC))
    // Two cables from the core (page 1) to the access switch (page 2): one connector on each page.
    const onP1 = offPageConnectors(s.getState().doc!, 'p1')
    expect(onP1).toHaveLength(1)
    expect(onP1[0]).toMatchObject({ nodeId: 'n-core', target: { kind: 'page', pageId: 'p2' } })
    expect(onP1[0]!.links).toHaveLength(2)
    expect(offPageConnectors(s.getState().doc!, 'p2')[0]!.target).toEqual({
      kind: 'page',
      pageId: 'p1',
    })

    // Cables to devices not on this diagram: to another diagram, or nowhere yet.
    const X = 'aaaaaaaa-0000-4000-8000-0000000000aa'
    const Y = 'aaaaaaaa-0000-4000-8000-0000000000bb'
    s.setState((st) => ({
      doc: {
        ...st.doc!,
        external: {
          e1: { id: 'e1', aId: CORE, bId: X, kind: 'ethernet', aPort: 'Gi1', bPort: 'Gi9' },
          e2: { id: 'e2', aId: Y, bId: CORE, kind: 'ethernet', aPort: 'eth0', bPort: 'Gi2' },
        },
        farEnds: {
          [X]: {
            id: X,
            kind: 'device',
            name: 'FW',
            type: 'firewall',
            siteId: SITE,
            siteCode: 'HQ',
          },
          [Y]: {
            id: Y,
            kind: 'device',
            name: 'CAM',
            type: 'ip_camera',
            siteId: SITE,
            siteCode: 'HQ',
          },
        },
        elsewhere: { [X]: [{ id: 'dg-edge', name: 'WAN' }] },
      },
    }))
    const all = offPageConnectors(s.getState().doc!, 'p1')
    const byKind = Object.fromEntries(all.map((c) => [c.target.kind, c]))
    expect(byKind.diagram).toMatchObject({
      target: { id: 'dg-edge', name: 'WAN' },
      far: [{ name: 'FW', port: 'Gi9' }],
    })
    expect(byKind.none).toMatchObject({ far: [{ name: 'CAM', port: 'eth0' }] })

    // Moving a connector keeps it there.
    s.getState().setPage('p1')
    const c = byKind.none!
    s.getState().dispatch(setStub(c.key, 'p1', 900, 40))
    expect(offPageConnectors(s.getState().doc!, 'p1').find((x) => x.key === c.key)).toMatchObject({
      x: 900,
      y: 40,
    })
  })
})

describe('shared networks (segments)', () => {
  it('places a segment with its cards; its cables to devices on the page are drawn', () => {
    const s = loaded()
    const SEG = 'dddddddd-0000-4000-8000-000000000001'
    s.getState().dispatch(
      addNode('segment', SEG, 300, -200, {
        segment: {
          id: SEG,
          name: 'MPLS Viettel',
          kind: 'mpls_l3vpn',
          vendorId: null,
          vendorName: 'Viettel',
          serviceId: 'VPN-42',
          notes: '',
          linkCount: 1,
          version: 1,
        },
        links: [{ id: 'l-seg', aId: CORE, bId: SEG, kind: 'ethernet', aPort: 'Gi0/0', bPort: '' }],
      }),
    )
    const d = s.getState().doc!
    expect(d.segments?.[SEG]?.name).toBe('MPLS Viettel')
    expect(d.view.edges.map((e) => e.linkId)).toEqual(['l-seg'])
  })
})
