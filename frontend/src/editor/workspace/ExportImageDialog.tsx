import { useReactFlow } from '@xyflow/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, csrfParam } from '@/api/client'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LinkKind } from '@/modules/inventory/links'
import { useDoc, useDocStoreApi } from './context'
import { downloadDataUrl, exportDiagramImage, fileNameOf, type LegendEntry } from './exportImage'

/**
 * Export the diagram as a picture (P1-22): PNG at 1x–4x or SVG, with a title block and a legend of the cable kinds
 * and states the diagram uses. The file is made in the browser; the export is recorded in the audit log.
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
  const { t } = useTranslation()
  const flow = useReactFlow()
  const doc = useDoc((s) => s.doc)!
  const store = useDocStoreApi()
  const [format, setFormat] = useState<'png' | 'svg' | 'ntb'>('png')
  const [scale, setScale] = useState(2)
  const [withLegend, setWithLegend] = useState(true)
  const [busy, setBusy] = useState(false)

  const legend = (): LegendEntry[] => {
    const kinds = new Set<string>()
    const states = new Set<string>()
    for (const e of doc.view.edges) {
      const l = doc.links[e.linkId]
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

  const run = async () => {
    if (format === 'ntb') return runNtb()
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
              onChange={(e) => setFormat(e.target.value as 'png' | 'svg' | 'ntb')}
            >
              <option value="png">{t('exportImage.png')}</option>
              <option value="svg">{t('exportImage.svg')}</option>
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
