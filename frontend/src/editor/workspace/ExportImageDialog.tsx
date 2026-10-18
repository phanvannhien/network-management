import { useReactFlow, type Node } from '@xyflow/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, csrfParam } from '@/api/client'
import { useSession } from '@/app/auth'
import { useOrganization } from '@/app/orgs'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LinkKind } from '@/modules/inventory/links'
import { docOnPage, pagesOf } from '../doc/pages'
import type { DocState } from '../doc/types'
import { useDoc, useDocStoreApi } from './context'
import {
  downloadDataUrl,
  exportDiagramImage,
  fileNameOf,
  imageSize,
  type LegendEntry,
} from './exportImage'
import {
  buildPdf,
  fitImage,
  pixelRatioFor,
  renderTitleBlock,
  sheetLayout,
  type Orientation,
  type Paper,
  type Sheet,
} from './exportPdf'

type Format = 'png' | 'svg' | 'pdf' | 'ntb'

/** Device labels are ~12 CSS px: below this many mm per px they print smaller than ~6 pt. */
const SMALL_TEXT_MM_PER_PX = 0.18

/** Waits (up to 3 s) for the canvas of another page to mount and measure its nodes. */
async function waitForCanvas(
  before: Element | null,
  nodes: () => Node[],
): Promise<HTMLElement | null> {
  const end = Date.now() + 3000
  while (Date.now() < end) {
    await new Promise((r) => requestAnimationFrame(r))
    const el = document.querySelector<HTMLElement>('.react-flow__viewport')
    const list = nodes()
    if (el && el !== before && list.every((n) => n.measured?.width)) return el
  }
  return document.querySelector<HTMLElement>('.react-flow__viewport')
}

/**
 * Export the diagram (P1-22, P2-11): PNG at 1x–4x or SVG with a title and a legend of the cable kinds and states it
 * uses; PDF on A4 / A3 with a frame and a title block, one sheet per page; or the data (.ntb.json). Files are made in
 * the browser; every export is recorded in the audit log.
 */
export function ExportImageDialog({
  orgId,
  diagramId,
  name,
  onClose,
}: {
  orgId: string
  diagramId: string
  name: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const flow = useReactFlow()
  const doc = useDoc((s) => s.doc)!
  const page = useDoc((s) => s.page)
  const layer = useDoc((s) => s.meta?.layer ?? 'physical')
  const version = useDoc((s) => s.meta?.version ?? 0)
  const store = useDocStoreApi()
  const org = useOrganization(orgId)
  const session = useSession()
  const [format, setFormat] = useState<Format>('png')
  const [scale, setScale] = useState(2)
  const [withLegend, setWithLegend] = useState(true)
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState<Paper>('a3')
  const [orientation, setOrientation] = useState<Orientation>('landscape')
  const [allPages, setAllPages] = useState(true)
  const [drawingNo, setDrawingNo] = useState('')
  const [revision, setRevision] = useState(String(version))
  const [checkedBy, setCheckedBy] = useState('')
  const [classification, setClassification] = useState<string>(() => t('exportPdf.internal'))
  const pages = pagesOf(doc.view, layer)
  const pageName = (id: string) => {
    const i = pages.findIndex((p) => p.id === id)
    return pages[i]?.name || t('pages.untitled', { n: i + 1 })
  }
  // Pages with something drawn on them (an empty page gives no sheet).
  const drawn = pages.filter((p) => {
    const v = docOnPage(doc, p.id).view
    return v.nodes.length > 0 || v.annotations.length > 0
  })

  const legend = (d: DocState = doc): LegendEntry[] => {
    const kinds = new Set<string>()
    const states = new Set<string>()
    for (const e of d.view.edges) {
      const l = d.links[e.linkId]
      if (!l) continue
      kinds.add(l.kind)
      if (l.status && l.status !== 'up') states.add(l.status)
    }
    return [
      ...[...kinds].sort().map((k) => ({
        edgeClass: `ntb-edge-${k}`,
        label: t(`links.kinds.${k as LinkKind}`),
      })),
      ...[...states].sort().map((st) => ({
        edgeClass: `ntb-edge-ethernet ntb-link-${st}`,
        label: t(`links.statuses.${st as 'down'}`),
      })),
    ]
  }

  /** The diagram and everything it uses as data (.ntb.json, ADR-037), built by the server (audited there). */
  const runNtb = async () => {
    setBusy(true)
    try {
      const r = await api.GET('/orgs/{orgId}/diagrams/{diagramId}/ntb', {
        params: { path: { orgId, diagramId } },
      })
      if (!r.data) throw new Error(t('exportImage.failed'))
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      downloadDataUrl(url, fileNameOf(name, 'ntb.json'))
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('exportImage.failed'))
    } finally {
      setBusy(false)
    }
  }

  /** Site codes of the devices on a page (title block). */
  const sitesOn = (d: DocState) => {
    const codes = new Set<string>()
    for (const n of d.view.nodes) {
      const c = n.refKind === 'device' ? d.devices[n.refId]?.siteCode : undefined
      if (c) codes.add(c)
    }
    const list = [...codes].sort()
    return list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', ')
  }

  const layout = sheetLayout(paper, orientation)
  // Will labels still be readable? Judged on the page shown (the others are not mounted).
  const shown = format === 'pdf' ? flow.getNodes().filter((n) => !n.hidden) : []
  const tooSmall =
    shown.length > 0 &&
    (() => {
      const size = imageSize({
        nodes: shown,
        bounds: flow.getNodesBounds(shown),
        legend: withLegend ? legend(docOnPage(doc, page)) : [],
        title: '',
      })
      return fitImage(layout.drawing, size.width, size.height).mmPerPx < SMALL_TEXT_MM_PER_PX
    })()

  /** PDF (P2-11): each page with something on it becomes one sheet, captured at print resolution in light colours. */
  const runPdf = async () => {
    const targets = allPages ? drawn : drawn.filter((p) => p.id === page)
    if (targets.length === 0) return void toast.error(t('exportPdf.empty'))
    setBusy(true)
    const st = store.getState()
    const startPage = st.page
    const view = flow.getViewport()
    const selection = st.selection
    const edgeSelection = st.edgeSelection
    // Fitting each page for the capture moves its remembered view: put every page's back afterwards.
    const prefix = `ntb-viewport:${diagramId}`
    const savedViews = Object.keys(localStorage)
      .filter((k) => k === prefix || k.startsWith(`${prefix}:`))
      .map((k) => [k, localStorage.getItem(k)] as const)
    const root = document.documentElement
    const dark = root.classList.contains('dark')
    try {
      st.setSelection([])
      st.setEdgeSelection([])
      // Paper is white: capture in the light theme.
      if (dark) root.classList.remove('dark')
      const date = new Date().toLocaleDateString(i18n.language)
      const user = session.data?.user
      const sheets: Sheet[] = []
      for (const [i, p] of targets.entries()) {
        let viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
        if (store.getState().page !== p.id) {
          store.getState().setPage(p.id)
          viewport = await waitForCanvas(viewport, () => flow.getNodes())
        }
        const nodes = flow.getNodes().filter((n) => !n.hidden)
        if (!viewport || nodes.length === 0) continue
        await flow.fitView({ duration: 0, padding: 0.05 })
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const d = docOnPage(store.getState().doc!, p.id)
        const lg = withLegend ? legend(d) : []
        const bounds = flow.getNodesBounds(nodes)
        const size = imageSize({ nodes, bounds, legend: lg, title: '' })
        const box = fitImage(layout.drawing, size.width, size.height)
        const drawing = await exportDiagramImage(viewport, {
          format: 'png',
          scale: pixelRatioFor(box.mmPerPx),
          title: '',
          subtitle: '',
          legendTitle: t('exportImage.legend'),
          legend: lg,
          nodes,
          bounds,
          background: '#ffffff',
        })
        const titleBlock = await renderTitleBlock(
          {
            org: org.data?.organization.name ?? '',
            sites: sitesOn(d),
            title: pages.length > 1 ? `${name} — ${pageName(p.id)}` : name,
            drawingNo,
            revision,
            date,
            drawnBy: user?.displayName || user?.email || '',
            checkedBy,
            sheet: `${i + 1} / ${targets.length}`,
            scale: t('exportPdf.notToScale'),
            classification,
            labels: {
              org: t('exportPdf.org'),
              sites: t('exportPdf.sites'),
              title: t('exportPdf.diagram'),
              drawingNo: t('exportPdf.drawingNo'),
              revision: t('exportPdf.revision'),
              date: t('exportPdf.date'),
              drawnBy: t('exportPdf.drawnBy'),
              checkedBy: t('exportPdf.checkedBy'),
              sheet: t('exportPdf.sheet'),
              scale: t('exportPdf.scale'),
              classification: t('exportPdf.classification'),
            },
          },
          layout.title,
        )
        sheets.push({ drawing, box, titleBlock })
      }
      if (sheets.length === 0) throw new Error(t('exportPdf.empty'))
      const blob = await buildPdf(sheets, paper, orientation, {
        title: name,
        author: user?.displayName || user?.email || '',
      })
      const url = URL.createObjectURL(blob)
      downloadDataUrl(url, fileNameOf(name, 'pdf'))
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      await api.POST('/orgs/{orgId}/export-events', {
        params: { ...csrfParam, path: { orgId } },
        body: { kind: 'diagram_pdf', diagramId, paper, count: sheets.length },
      })
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('exportImage.failed'))
    } finally {
      if (dark) root.classList.add('dark')
      for (const [k, v] of savedViews) if (v !== null) localStorage.setItem(k, v)
      const s = store.getState()
      if (s.page !== startPage) {
        const before = document.querySelector('.react-flow__viewport')
        s.setPage(startPage)
        await waitForCanvas(before, () => flow.getNodes())
      }
      void flow.setViewport(view, { duration: 0 })
      store.getState().setViewport(view)
      store.getState().setSelection(selection)
      store.getState().setEdgeSelection(edgeSelection)
      setBusy(false)
    }
  }

  const run = async () => {
    if (format === 'ntb') return runNtb()
    if (format === 'pdf') return runPdf()
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    // Every drawn thing counts for the picture's bounds: devices, groups, frames, texts, arrows, cluster boxes.
    const nodes = flow.getNodes().filter((n) => !n.hidden)
    if (!viewport || nodes.length === 0) return
    setBusy(true)
    // The canvas only renders what is on screen: show the whole drawing (no selection) for the capture, then put the
    // user's view and selection back.
    const view = flow.getViewport()
    const st = store.getState()
    const selection = st.selection
    const edgeSelection = st.edgeSelection
    try {
      st.setSelection([])
      st.setEdgeSelection([])
      await flow.fitView({ duration: 0, padding: 0.05 })
      await document.fonts.ready
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const bg =
        getComputedStyle(document.documentElement).getPropertyValue('--background').trim() ||
        '#ffffff'
      const url = await exportDiagramImage(viewport, {
        format: format as 'png' | 'svg',
        scale,
        title: name,
        subtitle: t('exportImage.subtitle', { date: new Date().toLocaleString() }),
        legendTitle: t('exportImage.legend'),
        legend: withLegend ? legend() : [],
        nodes,
        bounds: flow.getNodesBounds(nodes),
        background: bg,
      })
      downloadDataUrl(url, fileNameOf(name, format))
      await api.POST('/orgs/{orgId}/export-events', {
        params: { ...csrfParam, path: { orgId } },
        body: {
          kind: format === 'png' ? 'diagram_png' : 'diagram_svg',
          diagramId,
          scale: format === 'png' ? scale : 1,
        },
      })
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('exportImage.failed'))
    } finally {
      void flow.setViewport(view, { duration: 0 })
      store.getState().setSelection(selection)
      store.getState().setEdgeSelection(edgeSelection)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('exportImage.title')} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('exportImage.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">{t('exportImage.body')}</p>
        <FormField label={t('exportImage.format')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
            >
              <option value="png">{t('exportImage.png')}</option>
              <option value="svg">{t('exportImage.svg')}</option>
              <option value="pdf">{t('exportPdf.pdf')}</option>
              <option value="ntb">{t('exportImage.ntb')}</option>
            </NativeSelect>
          )}
        </FormField>
        {format === 'png' && (
          <FormField label={t('exportImage.scale')} guide={t('exportImage.scaleGuide')}>
            {(p) => (
              <NativeSelect {...p} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        {format === 'pdf' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('exportPdf.paper')} guide={t('exportPdf.paperGuide')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={paper}
                    onChange={(e) => setPaper(e.target.value as Paper)}
                  >
                    <option value="a3">A3</option>
                    <option value="a4">A4</option>
                  </NativeSelect>
                )}
              </FormField>
              <FormField label={t('exportPdf.orientation')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as Orientation)}
                  >
                    <option value="landscape">{t('exportPdf.landscape')}</option>
                    <option value="portrait">{t('exportPdf.portrait')}</option>
                  </NativeSelect>
                )}
              </FormField>
            </div>
            {drawn.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allPages} onCheckedChange={(v) => setAllPages(v === true)} />
                {t('exportPdf.allPages', { count: drawn.length })}
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <FormField
                label={t('exportPdf.drawingNo')}
                help="title-block"
                hint={t('exportPdf.drawingNoHint')}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={drawingNo}
                    maxLength={60}
                    onChange={(e) => setDrawingNo(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t('exportPdf.revision')} hint={t('exportPdf.revisionHint')}>
                {(p) => (
                  <Input
                    {...p}
                    value={revision}
                    maxLength={20}
                    onChange={(e) => setRevision(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t('exportPdf.checkedBy')}>
                {(p) => (
                  <Input
                    {...p}
                    value={checkedBy}
                    maxLength={80}
                    onChange={(e) => setCheckedBy(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t('exportPdf.classification')}>
                {(p) => (
                  <Input
                    {...p}
                    value={classification}
                    maxLength={60}
                    onChange={(e) => setClassification(e.target.value)}
                  />
                )}
              </FormField>
            </div>
            {tooSmall && (
              <p role="status" className="text-sm text-status-warning">
                {t('exportPdf.smallText')}
              </p>
            )}
          </>
        )}
        {format === 'ntb' && (
          <p className="text-sm text-muted-foreground">{t('exportImage.ntbGuide')}</p>
        )}
        {format !== 'ntb' && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={withLegend} onCheckedChange={(v) => setWithLegend(v === true)} />
            {t('exportImage.withLegend')}
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? t('exportImage.working') : t('exportImage.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
