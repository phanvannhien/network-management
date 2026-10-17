import type { Edge, Node } from '@xyflow/react'
import type { DiagramEdge, DiagramNode, DocState } from '../doc/types'

// Document → React Flow (P1-14). React Flow nodes are the view nodes; edges join the view nodes that show the two
// ends of a link. Node components read their own card from the store, so a node's data only carries references:
// changing one device does not change the props of the others.

export interface RefData extends Record<string, unknown> {
  refKind: DiagramNode['refKind']
  refId: string
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
    data: { refKind: n.refKind, refId: n.refId },
    selected: selection.has(n.id),
    draggable: !n.locked,
  }))
}

const EDGE_TYPE: Record<NonNullable<DiagramEdge['routing']>, string> = {
  straight: 'straight',
  orthogonal: 'smoothstep',
  curved: 'default',
}

/** Edges whose link ends are both on the view; the line style follows the link kind (SRS §6.2, index.css). */
export function toFlowEdges(doc: DocState): Edge[] {
  const nodeOf = new Map<string, string>()
  for (const n of doc.view.nodes) if (!nodeOf.has(n.refId)) nodeOf.set(n.refId, n.id)
  const out: Edge[] = []
  for (const e of doc.view.edges) {
    const l = doc.links[e.linkId]
    if (!l) continue
    const source = nodeOf.get(l.aId)
    const target = nodeOf.get(l.bId)
    if (!source || !target) continue
    out.push({
      id: e.id,
      source,
      target,
      type: EDGE_TYPE[e.routing ?? 'straight'],
      className: `ntb-edge-${l.kind}${l.draft ? ' ntb-edge-draft' : ''}`,
      data: { linkId: l.id },
    })
  }
  return out
}

/** Viewport zoom limits (SRS §6.1: 10–400 %). */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** Fit keeps the drawing clear of the floating toolbar on top. */
export const FIT_OPTIONS = {
  padding: { top: '72px', bottom: '32px', left: '32px', right: '32px' },
  maxZoom: 1.5,
} as const

export const GRID_SIZES = [10, 20, 40] as const
export type GridSize = (typeof GRID_SIZES)[number]
