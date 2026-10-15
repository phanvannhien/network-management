import type { Edge, Node } from '@xyflow/react'
import type { NtbData } from '../model/types'
import { edgeVisual, parallelCurvature } from './edges'
import { renderLabelTemplate } from './labels'

/**
 * Adapters from the NtbData model to React Flow's node/edge shape.
 * The canvas only reads the model through these selectors (CLAUDE.md convention);
 * all writes go through commands in the store.
 */

export interface DeviceNodeData extends Record<string, unknown> {
  deviceId: string
  label: string
}

/** Builds React Flow nodes for one page, one per device node on that page. */
export function buildNodes(
  data: NtbData,
  pageId: string,
  selection: string[] = [],
): Node<DeviceNodeData>[] {
  const page = data.pages[pageId]
  if (!page) return []
  const selected = new Set(selection)
  return page.nodes
    .filter((n) => data.devices[n.refId] !== undefined)
    .map((n) => {
      const device = data.devices[n.refId]
      return {
        id: n.refId,
        type: 'device',
        position: { x: n.x, y: n.y },
        selected: selected.has(n.refId),
        data: { deviceId: device.id, label: renderLabelTemplate(page.labelTemplate, device) },
        // Positions live in the store; React Flow reports changes, it doesn't own them.
        draggable: !n.locked,
      }
    })
}

/** Builds React Flow edges for the links that have an edge on this page. */
export function buildEdges(data: NtbData, pageId: string): Edge[] {
  const page = data.pages[pageId]
  if (!page) return []
  const drawn = page.edges
    .filter((e) => data.links[e.refId] !== undefined)
    .map((e) => data.links[e.refId])

  // Group by unordered endpoint pair to spread parallel links apart.
  const parallelIndex = new Map<string, number>()
  return drawn.map((link) => {
    const pairKey = [link.a.deviceId, link.b.deviceId].sort().join('|')
    const index = parallelIndex.get(pairKey) ?? 0
    parallelIndex.set(pairKey, index + 1)
    return {
      id: link.id,
      source: link.a.deviceId,
      target: link.b.deviceId,
      sourceHandle: null,
      targetHandle: null,
      type: 'link',
      pathOptions: { curvature: parallelCurvature(index) },
      data: {
        sourceLabel: interfaceName(data, link.a.deviceId, link.a.interfaceId),
        targetLabel: interfaceName(data, link.b.deviceId, link.b.interfaceId),
        speed: link.speed ?? '',
      },
      ...edgeVisual(link),
    }
  })
}

function interfaceName(data: NtbData, deviceId: string, interfaceId: string): string {
  return data.devices[deviceId]?.interfaces.find((i) => i.id === interfaceId)?.name ?? '?'
}

/** First page id by display order, or null when the document has no pages. */
export function firstPageId(data: NtbData): string | null {
  for (const id of data.pageOrder) {
    if (data.pages[id]) return id
  }
  return null
}
