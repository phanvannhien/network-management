import { portRanges } from './wiring'
import type { Edge, Node } from '@xyflow/react'
import type { AnnotationData, ClusterData } from './annotationNodes'
import type { CableData } from './CableEdge'
import { arrowOrigin, type ClusterBox } from './frames'
import { ANN, type DiagramNode, type DocState, type LinkCard } from '../doc/types'
import type { Lens } from '../doc/store'
import type { PageLayer } from '../doc/pages'
import { hostPart, isTransit, SUBNET_H, SUBNET_W } from '../doc/l3'
import type { L3EdgeData } from './L3Edge'
import { carries, l2Of, mergedL2, vidOfKey, vlanInfo, type Carry, type L2Edge } from '../l2/l2'

// Document → React Flow (P1-14). React Flow nodes are the view nodes; edges join the view nodes that show the two
// ends of a link. Node components read their own card from the store, so a node's data only carries references:
// changing one device does not change the props of the others.

export interface RefData extends Record<string, unknown> {
  refKind: DiagramNode['refKind']
  refId: string
  locked: boolean
  /** Label background (palette name) or ''. */
  labelColor: string
}

export const NODE_TYPES_BY_REF = {
  device: 'device',
  endpoint_group: 'group',
  site: 'site',
  diagram: 'ref',
  subnet: 'subnet',
  segment: 'segment',
} as const

export function toFlowNodes(doc: DocState, selection: ReadonlySet<string>): Node<RefData>[] {
  return doc.view.nodes.map((n) => ({
    id: n.id,
    type: NODE_TYPES_BY_REF[n.refKind],
    position: { x: n.x, y: n.y },
    data: {
      refKind: n.refKind,
      refId: n.refId,
      locked: Boolean(n.locked),
      labelColor: n.labelStyle?.color ?? '',
    },
    selected: selection.has(n.id),
    draggable: !n.locked,
    // A subnet bar of an L3 page has its own width (stretched by the user).
    ...(n.refKind === 'subnet' && { width: n.width ?? SUBNET_W, height: SUBNET_H }),
  }))
}

/**
 * Edges whose link ends are both on the view (P1-17: floating "cable" edges between node borders). The line style
 * follows the link kind (SRS §6.2, index.css); cables between the same two nodes are numbered so they spread apart.
 */
export interface EdgeLens {
  lens: Lens
  /** Layer of the page: an L3 page draws IP attachments instead of cables (P2-08). */
  layer?: PageLayer
  /** L2 view: the VLAN record picked (`vlanInfo().key`) — cables not carrying it fade. */
  vlanFilter?: string | null
}

/** Cables the L2 view leaves out: they carry no VLAN (power, console, stacking / HA heartbeat). */
const NOT_L2: ReadonlySet<string> = new Set(['power', 'console', 'stack'])

export function toFlowEdges(
  doc: DocState,
  selection: ReadonlySet<string> = new Set(),
  lens: EdgeLens = { lens: 'physical' },
): Edge<CableData>[] {
  // L3 lines carry their own data (L3Edge); the callers only read cable data from cable edges.
  if (lens.layer === 'l3') return toL3Edges(doc, selection) as Edge<CableData>[]
  const l2 = lens.lens === 'l2'
  const filter = l2 ? (lens.vlanFilter ?? null) : null
  const nodeOf = new Map<string, string>()
  for (const n of doc.view.nodes) if (!nodeOf.has(n.refId)) nodeOf.set(n.refId, n.id)
  const out: Edge<CableData>[] = []
  const pairCount = new Map<string, number>()
  // The cables of an endpoint group to one device are one edge (ports 1–24 of a PoE switch, ADR-036); on the L2 view
  // the member cables of a LAG are one edge too ("Po1 · 2 cables").
  const bundles = new Map<string, Edge<CableData>>()
  const bundlePorts = new Map<Edge<CableData>, string[]>()
  // L1: member cables of one LAG between one pair, for the ring drawn across them.
  const lagMembers = new Map<string, Edge<CableData>[]>()
  // L2: the member cards of each LAG line, so the line shows what all its members carry.
  const lagCards = new Map<Edge<CableData>, LinkCard[]>()
  for (const e of doc.view.edges) {
    const l = doc.links[e.linkId]
    if (!l) continue
    const source = nodeOf.get(l.aId)
    const target = nodeOf.get(l.bId)
    if (!source || !target) continue
    if (l2 && NOT_L2.has(l.kind)) continue
    const pair = source < target ? `${source}|${target}` : `${target}|${source}`
    const groupAt = doc.groups[l.aId] ? 'a' : doc.groups[l.bId] ? 'b' : null
    const lagKey =
      l.aL2?.lagId || l.bL2?.lagId
        ? `${pair}|lag|${[l.aL2?.lagId ?? '', l.bL2?.lagId ?? ''].sort().join('|')}`
        : null
    const bundleKey = groupAt ? `${pair}|${l.kind}` : l2 ? lagKey : null
    const rep = bundleKey ? bundles.get(bundleKey) : undefined
    if (rep) {
      rep.data!.bundle!.push(l.id)
      bundlePorts.get(rep)!.push((groupAt === 'a' ? l.bPort : l.aPort) ?? '')
      if (rep.data!.lag) {
        rep.data!.lagCount = (rep.data!.lagCount ?? 1) + 1
        lagCards.get(rep)!.push(l)
      }
      if (selection.has(e.id)) rep.selected = true
      continue
    }
    const index = pairCount.get(pair) ?? 0
    pairCount.set(pair, index + 1)
    const facts = l2 ? l2Of(l) : undefined
    const carry = facts && filter !== null ? carriesRecord(doc, l, facts, filter) : null
    out.push({
      id: e.id,
      source,
      target,
      type: 'cable',
      className: [
        `ntb-edge-${l.kind}`,
        l.draft && 'ntb-edge-draft',
        l.status && l.status !== 'up' && `ntb-link-${l.status}`,
        facts && `ntb-l2-${facts.kind}`,
        carry === 'no' && 'ntb-l2-faded',
        carry === 'maybe' && 'ntb-l2-maybe',
      ]
        .filter(Boolean)
        .join(' '),
      data: {
        linkId: l.id,
        aPort: l.aPort,
        bPort: l.bPort,
        status: l.status ?? 'up',
        index,
        count: 0,
        pair,
        ...(facts && { l2: facts, siteId: siteOf(doc, l.aId) ?? siteOf(doc, l.bId) }),
      },
      selected: selection.has(e.id),
    })
    const edge = out[out.length - 1]!
    if (bundleKey) {
      edge.data!.bundle = [l.id]
      bundles.set(bundleKey, edge)
      bundlePorts.set(edge, [(groupAt === 'a' ? l.bPort : l.aPort) ?? ''])
      edge.data!.groupAt = groupAt
      if (!groupAt) {
        lagCards.set(edge, [l])
        edge.data!.lag = l.aL2?.lagName || l.bL2?.lagName || 'LAG'
        edge.data!.lagCount = 1
        // The LAG's name at each end instead of one member's port.
        if (l.aL2?.lagName) edge.data!.aPort = l.aL2.lagName
        if (l.bL2?.lagName) edge.data!.bPort = l.bL2.lagName
      }
    } else if (lagKey) {
      const members = lagMembers.get(lagKey) ?? []
      members.push(edge)
      lagMembers.set(lagKey, members)
    }
  }
  // L2: a LAG line takes the facts of all its members (they may differ when the LAG itself has no mode).
  for (const [edge, cards] of lagCards) {
    if (cards.length < 2) continue
    const facts = mergedL2(cards)
    edge.data!.l2 = facts
    const carry =
      filter !== null ? worstCarry(cards.map((c) => carriesRecord(doc, c, l2Of(c), filter))) : null
    edge.className = [
      ...(edge.className ?? '').split(' ').filter((c) => c && !c.startsWith('ntb-l2-')),
      `ntb-l2-${facts.kind}`,
      carry === 'no' && 'ntb-l2-faded',
      carry === 'maybe' && 'ntb-l2-maybe',
    ]
      .filter(Boolean)
      .join(' ')
  }
  // L1: the ring across a LAG's member cables (Cisco / Visio symbol) is drawn by the first member.
  for (const members of lagMembers.values()) {
    if (members.length < 2) continue
    const l = doc.links[members[0]!.data!.linkId]!
    // Primitive fields, so an unchanged cable stays an unchanged edge for React Flow.
    members[0]!.data!.ring = l.aL2?.lagName || l.bL2?.lagName || 'LAG'
    members[0]!.data!.ringFrom = Math.min(...members.map((m) => m.data!.index))
    members[0]!.data!.ringTo = Math.max(...members.map((m) => m.data!.index))
  }
  for (const e of out) e.data!.count = pairCount.get(e.data!.pair as string) ?? 1
  // A bundle shows its ports as ranges at the device end: "Gi1/0/1–24 (24)".
  for (const [edge, names] of bundlePorts) {
    if (names.length < 2 || edge.data!.lag) continue
    const label = `${portRanges(names.filter(Boolean)) || '—'} (${names.length})`
    if (edge.data!.groupAt === 'a') edge.data!.bPort = label
    else edge.data!.aPort = label
  }
  return out
}

/**
 * An L3 page (P2-08): each device IP in a subnet drawn as a bar is a line down to the bar; a transit /30 / /31 not drawn
 * as a bar is a line between its two routers; endpoint groups hang from their subnet; of the cables, only logical ones
 * (VPN, GRE) are drawn.
 */
function toL3Edges(doc: DocState, selection: ReadonlySet<string>): Edge<CableData | L3EdgeData>[] {
  const l3 = doc.l3
  const out: Edge<CableData | L3EdgeData>[] = []
  const nodeOf = new Map<string, string>()
  const barOf = new Map<string, string>()
  for (const n of doc.view.nodes) {
    if (n.refKind === 'subnet') barOf.set(n.refId, n.id)
    else if (!nodeOf.has(n.refId)) nodeOf.set(n.refId, n.id)
  }
  if (l3) {
    const transit = new Map<string, { node: string; address: string }[]>()
    for (const a of l3.attachments) {
      const node = nodeOf.get(a.deviceId)
      if (!node || !a.subnetId) continue
      const bar = barOf.get(a.subnetId)
      if (bar) {
        out.push({
          id: `l3:${node}:${a.address}`,
          source: node,
          target: bar,
          type: 'l3',
          selectable: false,
          focusable: false,
          data: {
            kind: 'attach',
            label: `${a.interfaceName} ${hostPart(a.address)}`.trim(),
            gateway: a.isGateway,
          },
        })
        continue
      }
      const sn = l3.subnets[a.subnetId]
      if (sn && isTransit(sn.cidr)) {
        const list = transit.get(a.subnetId) ?? []
        list.push({ node, address: a.address })
        transit.set(a.subnetId, list)
      }
    }
    for (const [id, ends] of transit) {
      const [x, y] = ends
      if (!x || !y || x.node === y.node) continue
      out.push({
        id: `l3p:${id}`,
        source: x.node,
        target: y.node,
        type: 'l3',
        selectable: false,
        focusable: false,
        data: {
          kind: 'p2p',
          label: l3.subnets[id]!.cidr,
          aHost: hostPart(x.address),
          bHost: hostPart(y.address),
        },
      })
    }
    for (const [g, sn] of Object.entries(l3.groupSubnet)) {
      const node = nodeOf.get(g)
      const bar = barOf.get(sn)
      if (node && bar)
        out.push({
          id: `l3g:${node}`,
          source: node,
          target: bar,
          type: 'l3',
          selectable: false,
          focusable: false,
          data: { kind: 'attach', label: '' },
        })
    }
  }
  // VPN / GRE tunnels between routers stay drawn (they are L3).
  for (const e of doc.view.edges) {
    const l = doc.links[e.linkId]
    if (!l || l.kind !== 'logical') continue
    const source = nodeOf.get(l.aId)
    const target = nodeOf.get(l.bId)
    if (!source || !target) continue
    out.push({
      id: e.id,
      source,
      target,
      type: 'cable',
      className: 'ntb-edge-logical',
      data: {
        linkId: l.id,
        aPort: l.aPort,
        bPort: l.bPort,
        status: l.status ?? 'up',
        index: 0,
        count: 1,
      },
      selected: selection.has(e.id),
    })
  }
  return out
}

/** All members carry it → yes; none → no; else maybe. */
function worstCarry(list: Carry[]): Carry {
  if (list.every((c) => c === 'yes')) return 'yes'
  if (list.every((c) => c === 'no')) return 'no'
  return 'maybe'
}

function siteOf(doc: DocState, refId: string): string | undefined {
  return doc.devices[refId]?.siteId ?? doc.groups[refId]?.siteId
}

/**
 * Does a cable carry the picked VLAN record? The number must be carried and mean that record at one of its ends
 * (VLAN 20 of another site is another VLAN).
 */
function carriesRecord(doc: DocState, l: LinkCard, facts: L2Edge, key: string): Carry {
  const vid = vidOfKey(key)
  const c = carries(facts, vid)
  if (c === 'no') return c
  const vlans = doc.vlans ?? []
  const same = [l.aId, l.bId].some((id) => vlanInfo(vid, siteOf(doc, id), vlans).key === key)
  return same ? c : 'no'
}

/**
 * L2 view with a VLAN picked: the view nodes it touches (an end of a cable carrying it, or the device routing it).
 * null = nothing picked.
 */
export function litNodes(doc: DocState, lens: EdgeLens): Set<string> | null {
  if (lens.lens !== 'l2' || !lens.vlanFilter) return null
  const key = lens.vlanFilter
  const lit = new Set<string>()
  const refs = new Set<string>()
  for (const l of Object.values(doc.links)) {
    if (NOT_L2.has(l.kind)) continue
    if (carriesRecord(doc, l, l2Of(l), key) === 'no') continue
    refs.add(l.aId)
    refs.add(l.bId)
  }
  const vid = vidOfKey(key)
  for (const g of doc.gateways ?? [])
    if (g.vid === vid && `${g.siteId ?? 'org'}:${vid}` === key) refs.add(g.deviceId)
  for (const n of doc.view.nodes) if (refs.has(n.refId)) lit.add(n.id)
  return lit
}

/** Same value one level down: primitives by value, objects and arrays by their own (primitive) members. */
function sameShallow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) =>
    sameList((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** Same value, or two arrays with the same members (a bundle's link ids are a new array each time). */
function sameList(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => Object.is(x, b[i]))
  )
}

/** Two flow items equal for React Flow: each field the same, nested objects (position, data, measured) member-wise. */
export function sameItem(a: object, b: object): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) =>
    sameShallow((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/**
 * Keeps the previous object of every item that did not change (CLAUDE.md: changing one node must not re-render the
 * canvas). React Flow reuses its internal node when it gets the same object back, so only the moved node and its
 * cables re-render during a drag instead of every node and cable. `cache` is updated to the returned items.
 */
export function reuseUnchanged<T extends { id: string }>(cache: Map<string, T>, next: T[]): T[] {
  const out = next.map((item) => {
    const prev = cache.get(item.id)
    return prev && sameItem(prev, item) ? prev : item
  })
  cache.clear()
  for (const item of out) cache.set(item.id, item)
  return out
}

const GAP = 14

export interface Pt {
  x: number
  y: number
}

/** Where the line from the node centre towards `to` leaves the node's rectangle. */
export function borderPoint(rect: { x: number; y: number; w: number; h: number }, to: Pt): Pt {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = rect.w / 2 / Math.abs(dx || 1e-9)
  const sy = rect.h / 2 / Math.abs(dy || 1e-9)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

/** Perpendicular offset for cable `index` of `count` between one pair, centred on the straight line. */
export function parallelOffset(index: number, count: number): number {
  return (index - (count - 1) / 2) * GAP
}

/** Viewport zoom limits (SRS §6.1: 10–400 %). */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** Fit keeps the drawing clear of the floating toolbar, the library (left) and the property panel (right). */
export function fitOptions(libraryOpen: boolean, panelOpen = false) {
  return {
    padding: {
      top: '72px',
      bottom: '32px',
      left: libraryOpen ? '312px' : '32px',
      right: panelOpen ? '352px' : '32px',
    },
    maxZoom: 1.5,
  } as const
}

export const GRID_SIZES = [10, 20, 40] as const
export type GridSize = (typeof GRID_SIZES)[number]

/** React Flow ids of annotations (ANN, from the doc types) and cluster boxes, apart from view node ids. */
export { ANN }
export const CLUSTER = 'c:'
export const isAnnotationId = (id: string) => id.startsWith(ANN)
/** Off-page connectors (P2-08): derived nodes, never selected or deleted. */
export const OFFPAGE = 'o:'
export const isOverlayId = (id: string) =>
  id.startsWith(ANN) || id.startsWith(CLUSTER) || id.startsWith(OFFPAGE)

/**
 * Annotations as React Flow nodes (P1-19): frames under everything (only their title bar is grabbable, so the
 * selection box never picks them), text and arrows above cables.
 */
export function toAnnotationNodes(
  doc: DocState,
  selection: ReadonlySet<string>,
  canEdit: boolean,
): Node<AnnotationData>[] {
  return doc.view.annotations
    .filter(
      (a) => a.kind === 'zone' || a.kind === 'text' || a.kind === 'arrow' || a.kind === 'ipPlan',
    )
    .map((a) => {
      const id = ANN + a.id
      const base = {
        id,
        data: { annotationId: a.id },
        selected: selection.has(id),
        draggable: canEdit,
      }
      if (a.kind === 'zone')
        return {
          ...base,
          type: 'frame',
          position: { x: a.x, y: a.y },
          width: a.width ?? 400,
          height: a.height ?? 300,
          zIndex: -1,
          selectable: false,
          dragHandle: '.ntb-frame-title',
          // The wrapper takes pointer events when onNodeClick is set; only the title bar should.
          style: { pointerEvents: 'none' },
        }
      if (a.kind === 'arrow') return { ...base, type: 'arrow', position: arrowOrigin(a), zIndex: 5 }
      // A site's IP plan table, read from IPAM (P2-09).
      if (a.kind === 'ipPlan')
        return { ...base, type: 'ipplan', position: { x: a.x, y: a.y }, zIndex: 5 }
      return { ...base, type: 'text', position: { x: a.x, y: a.y }, zIndex: 5 }
    })
}

/** Cluster boxes (derived, not interactive). */
export function toClusterNodes(boxes: ClusterBox[]): Node<ClusterData>[] {
  return boxes.map((b) => ({
    id: CLUSTER + b.clusterId,
    type: 'cluster',
    position: { x: b.x, y: b.y },
    width: b.w,
    height: b.h,
    data: { name: b.name, kind: b.kind },
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: -1,
    style: { pointerEvents: 'none' },
  }))
}
