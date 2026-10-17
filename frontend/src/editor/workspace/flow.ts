import type { Edge, Node } from '@xyflow/react'
import type { AnnotationData, ClusterData } from './annotationNodes'
import type { CableData } from './CableEdge'
import { arrowOrigin, type ClusterBox } from './frames'
import type { DiagramNode, DocState } from '../doc/types'

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
  site: 'ref',
  diagram: 'ref',
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
  }))
}

/**
 * Edges whose link ends are both on the view (P1-17: floating "cable" edges between node borders). The line style
 * follows the link kind (SRS §6.2, index.css); cables between the same two nodes are numbered so they spread apart.
 */
export function toFlowEdges(
  doc: DocState,
  selection: ReadonlySet<string> = new Set(),
): Edge<CableData>[] {
  const nodeOf = new Map<string, string>()
  for (const n of doc.view.nodes) if (!nodeOf.has(n.refId)) nodeOf.set(n.refId, n.id)
  const out: Edge<CableData>[] = []
  const pairCount = new Map<string, number>()
  for (const e of doc.view.edges) {
    const l = doc.links[e.linkId]
    if (!l) continue
    const source = nodeOf.get(l.aId)
    const target = nodeOf.get(l.bId)
    if (!source || !target) continue
    const pair = source < target ? `${source}|${target}` : `${target}|${source}`
    const index = pairCount.get(pair) ?? 0
    pairCount.set(pair, index + 1)
    out.push({
      id: e.id,
      source,
      target,
      type: 'cable',
      className: [
        `ntb-edge-${l.kind}`,
        l.draft && 'ntb-edge-draft',
        l.status && l.status !== 'up' && `ntb-link-${l.status}`,
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
      },
      selected: selection.has(e.id),
    })
  }
  for (const e of out) e.data!.count = pairCount.get(e.data!.pair as string) ?? 1
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

/** React Flow ids of annotations and cluster boxes, apart from view node ids. */
export const ANN = 'a:'
export const CLUSTER = 'c:'
export const isAnnotationId = (id: string) => id.startsWith(ANN)
export const isOverlayId = (id: string) => id.startsWith(ANN) || id.startsWith(CLUSTER)

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
    .filter((a) => a.kind === 'zone' || a.kind === 'text' || a.kind === 'arrow')
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
        }
      if (a.kind === 'arrow') return { ...base, type: 'arrow', position: arrowOrigin(a), zIndex: 5 }
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
  }))
}
