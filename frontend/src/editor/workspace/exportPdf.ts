import { toPng } from 'html-to-image'

// Diagram PDF (P2-11, ADR-050): one sheet per diagram page on A4 / A3, a frame and a title block in the bottom-right
// corner. The drawing is captured at print resolution — its devices are HTML, which no SVG-to-PDF converter reads —
// and the title block is rendered by the browser too, so Vietnamese text keeps the app's font (PDF base fonts have
// no Vietnamese glyphs).

export type Paper = 'a4' | 'a3'
export type Orientation = 'landscape' | 'portrait'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** ISO 216 sizes in mm, long side first. */
const SIZES: Record<Paper, [number, number]> = { a4: [297, 210], a3: [420, 297] }
const MARGIN = 10
const GAP = 3
const TITLE_H = 32
const TITLE_W = 170
/** Print resolution of the drawing. */
export const DPI = 300
/** A small drawing is not blown up past twice its size on screen (1 CSS px ≈ 0.26 mm). */
const MAX_MM_PER_PX = 0.53
/** Title block layout scale: CSS px per mm. */
const PX_PER_MM = 4

/** Where things go on a sheet (mm): page size, frame, drawing area above the title block, title block. */
export function sheetLayout(paper: Paper, orientation: Orientation) {
  const [long, short] = SIZES[paper]
  const width = orientation === 'landscape' ? long : short
  const height = orientation === 'landscape' ? short : long
  const frame = { x: MARGIN, y: MARGIN, w: width - 2 * MARGIN, h: height - 2 * MARGIN }
  const tw = Math.min(TITLE_W, frame.w)
  const title = { x: frame.x + frame.w - tw, y: frame.y + frame.h - TITLE_H, w: tw, h: TITLE_H }
  const drawing = {
    x: frame.x + GAP,
    y: frame.y + GAP,
    w: frame.w - 2 * GAP,
    h: frame.h - TITLE_H - 2 * GAP,
  }
  return { width, height, frame, title, drawing }
}

/** A picture of w × h CSS px fitted into the area (mm), centred; mmPerPx sets the capture resolution. */
export function fitImage(area: Box, w: number, h: number): Box & { mmPerPx: number } {
  const mmPerPx = Math.min(area.w / w, area.h / h, MAX_MM_PER_PX)
  const fw = w * mmPerPx
  const fh = h * mmPerPx
  return {
    x: area.x + (area.w - fw) / 2,
    y: area.y + (area.h - fh) / 2,
    w: fw,
    h: fh,
    mmPerPx,
  }
}

/** Capture pixel ratio for a fitted picture to print at DPI. */
export function pixelRatioFor(mmPerPx: number): number {
  return (mmPerPx * DPI) / 25.4
}

export interface TitleBlock {
  org: string
  sites: string
  title: string
  drawingNo: string
  revision: string
  date: string
  drawnBy: string
  checkedBy: string
  sheet: string
  scale: string
  classification: string
  labels: Record<
    | 'org'
    | 'sites'
    | 'title'
    | 'drawingNo'
    | 'revision'
    | 'date'
    | 'drawnBy'
    | 'checkedBy'
    | 'sheet'
    | 'scale'
    | 'classification',
    string
  >
}

function cell(
  label: string,
  value: string,
  opts: { span?: number; big?: boolean; last?: boolean } = {},
) {
  const el = document.createElement('div')
  Object.assign(el.style, {
    borderRight: opts.last ? 'none' : '1px solid #000',
    borderBottom: '1px solid #000',
    padding: '2px 5px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: '0',
  } satisfies Partial<CSSStyleDeclaration>)
  if (opts.span) el.style.gridColumn = `span ${opts.span}`
  const l = document.createElement('div')
  Object.assign(l.style, { fontSize: '7px', color: '#444', lineHeight: '9px' })
  l.textContent = label
  const v = document.createElement('div')
  Object.assign(v.style, {
    fontSize: opts.big ? '13px' : '11px',
    fontWeight: opts.big ? '600' : '400',
    lineHeight: opts.big ? '16px' : '14px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
  v.textContent = value || ' '
  el.append(l, v)
  return el
}

/** The title block as HTML (black on white whatever the theme), sized wMm × hMm at PX_PER_MM. */
export function titleBlockElement(tb: TitleBlock, wMm: number, hMm: number): HTMLElement {
  const root = document.createElement('div')
  Object.assign(root.style, {
    width: `${wMm * PX_PER_MM}px`,
    height: `${hMm * PX_PER_MM}px`,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 34%',
    gridTemplateRows: 'repeat(4, 1fr)',
    background: '#fff',
    color: '#000',
    fontFamily: getComputedStyle(document.body).fontFamily,
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>)
  const L = tb.labels
  root.append(
    cell(L.org, tb.org),
    cell(L.sites, tb.sites),
    cell(L.drawingNo, tb.drawingNo, { last: true }),
    cell(L.title, tb.title, { span: 2, big: true }),
    cell(L.revision, tb.revision, { last: true }),
    cell(L.drawnBy, tb.drawnBy),
    cell(L.checkedBy, tb.checkedBy),
    cell(L.date, tb.date, { last: true }),
    cell(L.scale, tb.scale),
    cell(L.classification, tb.classification),
    cell(L.sheet, tb.sheet, { last: true }),
  )
  // The last row has no bottom border: the frame draws it.
  for (const el of Array.from(root.children).slice(-3))
    (el as HTMLElement).style.borderBottom = 'none'
  return root
}

/** Renders the title block to a PNG data URL at DPI. */
export async function renderTitleBlock(tb: TitleBlock, box: Box): Promise<string> {
  const el = titleBlockElement(tb, box.w, box.h)
  // In the document (fonts, layout) but off screen; the capture puts it back at the origin.
  el.style.position = 'fixed'
  el.style.left = '-100000px'
  el.style.top = '0'
  document.body.appendChild(el)
  try {
    await document.fonts.ready
    return await toPng(el, {
      backgroundColor: '#ffffff',
      pixelRatio: DPI / 25.4 / PX_PER_MM,
      style: { position: 'static', left: '0' },
    })
  } finally {
    el.remove()
  }
}

export interface Sheet {
  /** PNG data URL of the drawing (with its legend). */
  drawing: string
  /** Where it goes on the sheet (mm), from fitImage. */
  box: Box
  /** PNG data URL of the title block. */
  titleBlock: string
}

/** Builds the PDF (jsPDF is loaded on first use) and returns it as a Blob. */
export async function buildPdf(
  sheets: Sheet[],
  paper: Paper,
  orientation: Orientation,
  meta: { title: string; author: string },
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const L = sheetLayout(paper, orientation)
  const pdf = new jsPDF({ orientation, unit: 'mm', format: paper, compress: true })
  pdf.setProperties({ title: meta.title, author: meta.author, creator: 'Network Topology Builder' })
  sheets.forEach((s, i) => {
    if (i > 0) pdf.addPage(paper, orientation)
    pdf.addImage(s.drawing, 'PNG', s.box.x, s.box.y, s.box.w, s.box.h, undefined, 'FAST')
    pdf.addImage(s.titleBlock, 'PNG', L.title.x, L.title.y, L.title.w, L.title.h, undefined, 'FAST')
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.5)
    pdf.rect(L.frame.x, L.frame.y, L.frame.w, L.frame.h)
    pdf.setLineWidth(0.35)
    pdf.rect(L.title.x, L.title.y, L.title.w, L.title.h)
  })
  return pdf.output('blob')
}
