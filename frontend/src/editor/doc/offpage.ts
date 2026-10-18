import { NODE_H, NODE_W } from '../workspace/frames'
import { firstPageId, pagesOfRefs } from './pages'
import type { DocState, LinkCard } from './types'

// Off-page connectors (P2-08, ADR-047): a cable with one end on the page is never hidden. Its far end is drawn on
// another page of this diagram, on another diagram, or nowhere yet; the connector says which and leads there. They
// are derived (never drawn by hand): only the position of a connector the user moved is kept (view.stubs).

export type ConnectorTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'diagram'; id: string; name: string }
  | { kind: 'none' }

export interface FarRef {
  id: string
  kind: 'device' | 'endpoint_group' | 'segment'
  name: string
  /** Port at the far end (empty when none). */
  port: string
}

export interface Connector {
  /** Stable while the cable keeps the same ends: view node > target. */
  key: string
  /** The view node on this page the cables leave from. */
  nodeId: string
  target: ConnectorTarget
  /** Far ends (one for "nowhere yet": each can be placed here). */
  far: FarRef[]
  links: LinkCard[]
  x: number
  y: number
}

/** Room between a node and its first connector, and between stacked connectors. */
const GAP_X = 70
const GAP_Y = 40

/**
 * Connectors of one page, grouped per view node and target (four cables from one switch to page "Floor 2" are one
 * connector). Auto-placed to the right of their node unless the user moved them.
 */
export function offPageConnectors(doc: DocState, pageId: string): Connector[] {
  const first = firstPageId(doc.view)
  const here = new Map<string, string>()
  for (const n of doc.view.nodes) if ((n.pageId || first) === pageId) here.set(n.refId, n.id)
  if (here.size === 0) return []
  const refPages = pagesOfRefs(doc.view)
  const nodeById = new Map(doc.view.nodes.map((n) => [n.id, n]))
  const stubs = new Map(
    (doc.view.stubs ?? []).filter((s) => (s.pageId || first) === pageId).map((s) => [s.key, s]),
  )
  const groups = new Map<string, Connector>()
  const add = (l: LinkCard) => {
    const aHere = here.has(l.aId)
    const bHere = here.has(l.bId)
    if (aHere === bHere) return
    const nodeId = here.get(aHere ? l.aId : l.bId)!
    const farId = aHere ? l.bId : l.aId
    const port = (aHere ? l.bPort : l.aPort) ?? ''
    const onPages = (refPages.get(farId) ?? []).filter((p) => p !== pageId)
    const other = doc.elsewhere?.[farId]?.[0]
    const target: ConnectorTarget = onPages[0]
      ? { kind: 'page', pageId: onPages[0] }
      : other
        ? { kind: 'diagram', id: other.id, name: other.name }
        : { kind: 'none' }
    const tkey =
      target.kind === 'page'
        ? `p:${target.pageId}`
        : target.kind === 'diagram'
          ? `d:${target.id}`
          : `x:${farId}`
    const key = `${nodeId}>${tkey}`
    let c = groups.get(key)
    if (!c) {
      c = { key, nodeId, target, far: [], links: [], x: 0, y: 0 }
      groups.set(key, c)
    }
    c.links.push(l)
    if (!c.far.some((f) => f.id === farId)) c.far.push({ ...farOf(doc, farId), port })
  }
  for (const l of Object.values(doc.links)) add(l)
  for (const l of Object.values(doc.external ?? {})) if (!doc.links[l.id]) add(l)
  // Place: a stack to the right of the node, in a stable order; a moved connector stays where it was put.
  const out = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
  const perNode = new Map<string, number>()
  for (const c of out) {
    const i = perNode.get(c.nodeId) ?? 0
    perNode.set(c.nodeId, i + 1)
    const stub = stubs.get(c.key)
    const n = nodeById.get(c.nodeId)!
    c.x = stub ? stub.x : n.x + NODE_W + GAP_X
    c.y = stub ? stub.y : n.y + NODE_H / 2 - 14 + i * GAP_Y
  }
  return out
}

function farOf(doc: DocState, id: string): Omit<FarRef, 'port'> {
  const d = doc.devices[id]
  if (d) return { id, kind: 'device', name: d.hostname }
  const g = doc.groups[id]
  if (g) return { id, kind: 'endpoint_group', name: g.name }
  const sg = doc.segments?.[id]
  if (sg) return { id, kind: 'segment', name: sg.name }
  const f = doc.farEnds?.[id]
  return { id, kind: f?.kind ?? 'device', name: f?.name ?? '?' }
}
