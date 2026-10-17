import type { components } from '@/api/client'

type View = components['schemas']['DiagramView']

const NODE_W = 144
const NODE_H = 80
const GAP_X = 48
const GAP_Y = 56
const PAD = 32
const TITLE = 36
const COLS = 3

/**
 * A first diagram of what was imported (P1-21): one frame per site (ADR-032), the site's devices in a grid inside it,
 * members of a cluster next to each other. No cables — the spreadsheet has none; the user draws them.
 */
export function importedView(
  devices: { id: string; siteId: string; group: string }[],
  siteOrder: string[],
  newId: () => string = () => crypto.randomUUID(),
): View {
  const nodes: View['nodes'] = []
  const annotations: View['annotations'] = []
  let x = 0
  for (const siteId of siteOrder) {
    const here = devices
      .filter((d) => d.siteId === siteId)
      .sort((a, b) => a.group.localeCompare(b.group))
    if (here.length === 0) continue
    const cols = Math.min(COLS, here.length)
    const rows = Math.ceil(here.length / cols)
    const width = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X
    const height = TITLE + PAD + rows * NODE_H + (rows - 1) * GAP_Y + PAD
    annotations.push({ id: newId(), kind: 'zone', x, y: 0, width, height, siteId })
    here.forEach((d, i) => {
      nodes.push({
        id: newId(),
        refKind: 'device',
        refId: d.id,
        x: x + PAD + (i % cols) * (NODE_W + GAP_X),
        y: TITLE + PAD + Math.floor(i / cols) * (NODE_H + GAP_Y),
      })
    })
    x += width + 80
  }
  // No viewport: the editor fits the whole drawing on first open.
  return { nodes, edges: [], annotations }
}
