import type { Annotation } from '../doc/commands'
import type { DocState } from '../doc/types'

// Frames on the diagram (P1-19, ADR-032): rectangles (zone annotations), optionally bound to a site / location. A
// device belongs visually to a frame when its node centre is inside it; with nested frames the smallest wins. Cluster
// boxes are derived from the inventory (never drawn by hand), around the members of one cluster on the view.

/** Room around an arrow's line inside its node box. */
export const ARROW_PAD = 8

export const NODE_W = 144
export const NODE_H = 80
/** Room above the devices for the frame title. */
const TITLE = 32
const PAD = 24

export type Sizes = Record<string, { width: number; height: number } | undefined>

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const sizeOf = (sizes: Sizes, id: string) => ({
  w: sizes[id]?.width ?? NODE_W,
  h: sizes[id]?.height ?? NODE_H,
})

export function frameRect(a: Annotation): Rect {
  return { x: a.x, y: a.y, w: a.width ?? 0, h: a.height ?? 0 }
}

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

/** View nodes whose centre lies in the frame. */
export function nodesInFrame(doc: DocState, frame: Annotation, sizes: Sizes): string[] {
  const r = frameRect(frame)
  return doc.view.nodes
    .filter((n) => {
      const { w, h } = sizeOf(sizes, n.id)
      return inside(r, n.x + w / 2, n.y + h / 2)
    })
    .map((n) => n.id)
}

/** The smallest site / location frame containing a point (where a new device lands). */
export function frameAt(doc: DocState, x: number, y: number): Annotation | null {
  let best: Annotation | null = null
  for (const a of doc.view.annotations) {
    if (a.kind !== 'zone' || !a.siteId) continue
    const r = frameRect(a)
    if (!inside(r, x, y)) continue
    if (!best || r.w * r.h < (best.width ?? 0) * (best.height ?? 0)) best = a
  }
  return best
}

/** A frame around some nodes, with room for its title. */
export function rectAround(doc: DocState, nodeIds: string[], sizes: Sizes): Rect | null {
  const nodes = doc.view.nodes.filter((n) => nodeIds.includes(n.id))
  if (nodes.length === 0) return null
  const x0 = Math.min(...nodes.map((n) => n.x))
  const y0 = Math.min(...nodes.map((n) => n.y))
  const x1 = Math.max(...nodes.map((n) => n.x + sizeOf(sizes, n.id).w))
  const y1 = Math.max(...nodes.map((n) => n.y + sizeOf(sizes, n.id).h))
  return { x: x0 - PAD, y: y0 - PAD - TITLE, w: x1 - x0 + 2 * PAD, h: y1 - y0 + 2 * PAD + TITLE }
}

/** The one site all the given devices share, if any (a frame around them is bound to it). */
export function sharedSite(doc: DocState, nodeIds: string[]): string | null {
  const sites = new Set<string>()
  for (const n of doc.view.nodes)
    if (nodeIds.includes(n.id) && n.refKind === 'device') {
      const d = doc.devices[n.refId]
      if (d) sites.add(d.siteId)
    }
  return sites.size === 1 ? [...sites][0]! : null
}

export interface ClusterBox extends Rect {
  clusterId: string
  name: string
  kind: string
}

/** A box around the members of each cluster with two or more members on the view (HA pair, stack…). */
export function clusterBoxes(doc: DocState, sizes: Sizes): ClusterBox[] {
  const groups = new Map<string, { name: string; kind: string; ids: string[] }>()
  for (const n of doc.view.nodes) {
    const d = n.refKind === 'device' ? doc.devices[n.refId] : undefined
    if (!d?.clusterId) continue
    const g = groups.get(d.clusterId) ?? {
      name: d.clusterName ?? '',
      kind: d.clusterKind ?? '',
      ids: [],
    }
    g.ids.push(n.id)
    groups.set(d.clusterId, g)
  }
  const out: ClusterBox[] = []
  for (const [clusterId, g] of groups) {
    if (g.ids.length < 2) continue
    const r = rectAround(doc, g.ids, sizes)!
    // Inside a frame drawn around the same devices: below its title bar, room for the small label at the top.
    out.push({
      clusterId,
      name: g.name,
      kind: g.kind,
      x: r.x + 12,
      y: r.y + TITLE,
      w: r.w - 24,
      h: r.h - TITLE - 12,
    })
  }
  return out
}

/** Top-left of an arrow's node box (its two ends are absolute points). */
export function arrowOrigin(a: Annotation): { x: number; y: number } {
  const end = a.points?.[0] ?? { x: a.x + 120, y: a.y }
  return { x: Math.min(a.x, end.x) - ARROW_PAD, y: Math.min(a.y, end.y) - ARROW_PAD }
}
