import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { addAnnotation, newId, removeAnnotations } from '../doc/commands'
import type { DocStoreApi } from '../doc/store'
import { ANN, isAnnotationId } from './flow'
import { NODE_H, NODE_W, rectAround, sharedSite, type Sizes } from './frames'
import { onPageState } from '../doc/pages'

/**
 * Adding annotations (P1-19): a frame (around the selected devices — bound to their site when they share one — or an
 * empty one in the middle), a text, an arrow; Ctrl+Shift+G removes the selected frames (their devices stay).
 */
export function useAnnotate({
  store,
  canEdit,
  centre,
  sizes,
}: {
  store: DocStoreApi
  canEdit: boolean
  centre: () => { x: number; y: number }
  sizes: () => Sizes
}) {
  const { t } = useTranslation()
  const add = (a: Parameters<typeof addAnnotation>[0]) => {
    store.getState().dispatch(addAnnotation(a))
    store.getState().setSelection([ANN + a.id])
  }
  const frame = () => {
    const s = onPageState(store.getState())
    if (!canEdit || !s.doc) return
    const picked = s.selection.filter((id) => s.doc!.view.nodes.some((n) => n.id === id))
    const r = picked.length > 0 ? rectAround(s.doc, picked, sizes()) : null
    const c = centre()
    const site = picked.length > 0 ? sharedSite(s.doc, picked) : null
    add({
      id: newId(),
      kind: 'zone',
      x: Math.round(r?.x ?? c.x - 240),
      y: Math.round(r?.y ?? c.y - 160),
      width: Math.round(r?.w ?? 480),
      height: Math.round(r?.h ?? 320),
      ...(site ? { siteId: site } : {}),
    })
    if (picked.length > 0 && !site) toast.info(t('frames.mixedSites'))
  }
  /** A frame drawn by dragging (frame tool): bound to the site its devices share, nothing else gathered. */
  const frameAt = (r: { x: number; y: number; w: number; h: number }) => {
    const s = onPageState(store.getState())
    if (!canEdit || !s.doc) return
    const z = sizes()
    const inside = s.doc.view.nodes
      .filter((n) => {
        const w = z[n.id]?.width ?? NODE_W
        const h = z[n.id]?.height ?? NODE_H
        const cx = n.x + w / 2
        const cy = n.y + h / 2
        return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
      })
      .map((n) => n.id)
    const site = inside.length > 0 ? sharedSite(s.doc, inside) : null
    add({
      id: newId(),
      kind: 'zone',
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      ...(site ? { siteId: site } : {}),
    })
    if (inside.length > 0 && !site) toast.info(t('frames.mixedSites'))
  }
  const text = () => {
    if (!canEdit) return
    const c = centre()
    add({
      id: newId(),
      kind: 'text',
      x: Math.round(c.x - 40),
      y: Math.round(c.y),
      text: t('frames.newText'),
      fontSize: 16,
    })
  }
  /** The IP plan table of a site (P2-09), read from IPAM. */
  const ipPlan = (siteId: string) => {
    if (!canEdit) return
    const c = centre()
    add({ id: newId(), kind: 'ipPlan', x: Math.round(c.x - 200), y: Math.round(c.y), siteId })
  }
  const arrow = () => {
    if (!canEdit) return
    const c = centre()
    add({
      id: newId(),
      kind: 'arrow',
      x: Math.round(c.x - 80),
      y: Math.round(c.y),
      points: [{ x: Math.round(c.x + 80), y: Math.round(c.y) }],
    })
  }
  const ungroup = () => {
    const s = onPageState(store.getState())
    if (!canEdit || !s.doc) return
    const frames = s.selection
      .filter(isAnnotationId)
      .map((id) => id.slice(ANN.length))
      .filter((id) => s.doc!.view.annotations.some((a) => a.id === id && a.kind === 'zone'))
    if (frames.length > 0) s.dispatch(removeAnnotations(frames))
  }
  return { frame, frameAt, text, arrow, ipPlan, ungroup }
}
