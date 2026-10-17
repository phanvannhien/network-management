import { getNodesBounds, type Node } from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'

// Diagram picture export (P1-22, SRS §12): the drawing as PNG (1x–4x) or SVG, with a title block above and a legend
// of the cable kinds / states it uses below. Both are rendered into the React Flow viewport for the capture (same
// fonts, same CSS for line styles), then removed.

export interface LegendEntry {
  /** CSS classes of an edge (e.g. "ntb-edge-fiber", "ntb-link-down"), drawn as a sample line. */
  edgeClass: string
  label: string
}

export interface ImageExport {
  format: 'png' | 'svg'
  scale: number
  title: string
  subtitle: string
  legendTitle: string
  legend: LegendEntry[]
  nodes: Node[]
  background: string
}

const PAD = 40
const HEADER = 56
const LEGEND_ROW = 22

/** Pieces of the editor that must not appear in the picture. */
const EXCLUDED = [
  'react-flow__resize-control',
  'react-flow__handle',
  'ntb-connect',
  'react-flow__nodesselection',
]

function block(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const el = document.createElement(tag)
  Object.assign(el.style, style)
  if (text !== undefined) el.textContent = text
  return el
}

/** The legend: one row per cable kind / state, each with a sample line styled by the editor's own CSS. */
function legendElement(e: ImageExport, x: number, y: number, width: number): HTMLElement {
  const box = block('div', {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    fontSize: '12px',
    color: 'var(--foreground)',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px 24px',
  })
  box.appendChild(
    block('div', { width: '100%', fontWeight: '600', marginBottom: '2px' }, e.legendTitle),
  )
  const ns = 'http://www.w3.org/2000/svg'
  for (const item of e.legend) {
    const row = block('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      height: `${LEGEND_ROW - 4}px`,
    })
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '44')
    svg.setAttribute('height', '12')
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('class', `react-flow__edge ${item.edgeClass}`)
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('class', 'react-flow__edge-path')
    path.setAttribute('d', 'M2 6 H42')
    path.setAttribute('fill', 'none')
    g.appendChild(path)
    svg.appendChild(g)
    row.appendChild(svg)
    row.appendChild(block('span', {}, item.label))
    box.appendChild(row)
  }
  return box
}

/** Renders the picture and returns a data URL (PNG or SVG). */
export async function exportDiagramImage(viewport: HTMLElement, e: ImageExport): Promise<string> {
  const bounds = getNodesBounds(e.nodes)
  const width = Math.max(480, Math.ceil(bounds.width + PAD * 2))
  const legendRows = Math.ceil(e.legend.length / Math.max(1, Math.floor(width / 220))) + 1
  const legendHeight = e.legend.length > 0 ? legendRows * LEGEND_ROW + 16 : 0
  const height = Math.ceil(HEADER + bounds.height + PAD * 2 + legendHeight)
  // Browsers refuse canvases beyond ~16k px a side / ~16.7M px: lower the scale of a huge drawing instead of failing.
  const maxScale = Math.max(
    1,
    Math.floor(Math.min(16000 / width, 16000 / height, Math.sqrt(16_700_000 / (width * height)))),
  )
  const scale = Math.min(e.scale, maxScale)
  const ox = bounds.x - PAD
  const oy = bounds.y - PAD - HEADER

  // Title block and legend live in flow coordinates, around the drawing.
  const header = block('div', {
    position: 'absolute',
    left: `${ox + PAD}px`,
    top: `${oy + 12}px`,
    color: 'var(--foreground)',
  })
  header.appendChild(block('div', { fontSize: '18px', fontWeight: '600' }, e.title))
  header.appendChild(
    block('div', { fontSize: '12px', color: 'var(--muted-foreground)' }, e.subtitle),
  )
  const extras: HTMLElement[] = [header]
  if (e.legend.length > 0)
    extras.push(legendElement(e, ox + PAD, bounds.y + bounds.height + PAD, width - PAD * 2))
  for (const el of extras) viewport.appendChild(el)
  // html-to-image copies computed styles to HTML elements only: lines (cables, legend samples, arrows) would lose their
  // stroke. Write the shown stroke on each SVG shape for the capture, then restore it.
  const restore: [SVGElement, string | null][] = []
  for (const shape of viewport.querySelectorAll<SVGElement>(
    'path, line, polyline, circle, rect, text',
  )) {
    const cs = getComputedStyle(shape)
    restore.push([shape, shape.getAttribute('style')])
    shape.setAttribute(
      'style',
      [
        shape.getAttribute('style') ?? '',
        `stroke:${cs.stroke}`,
        `stroke-width:${cs.strokeWidth}`,
        `stroke-dasharray:${cs.strokeDasharray}`,
        `stroke-linecap:${cs.strokeLinecap}`,
        `fill:${cs.fill}`,
        `opacity:${cs.opacity}`,
        `font-size:${cs.fontSize}`,
        `font-family:${cs.fontFamily}`,
      ].join(';'),
    )
  }
  try {
    const options = {
      backgroundColor: e.background,
      width,
      height,
      pixelRatio: e.format === 'png' ? scale : 1,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${-ox}px, ${-oy}px) scale(1)`,
      },
      filter: (node: HTMLElement) =>
        !(node.classList && EXCLUDED.some((c) => node.classList.contains(c))),
    }
    return e.format === 'png' ? await toPng(viewport, options) : await toSvg(viewport, options)
  } finally {
    for (const el of extras) el.remove()
    for (const [shape, style] of restore)
      if (style === null) shape.removeAttribute('style')
      else shape.setAttribute('style', style)
  }
}

/** Saves a data URL as a file. */
export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** A file name from the diagram name: letters, digits and dashes. */
export function fileNameOf(name: string, ext: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${base || 'so-do'}.${ext}`
}
