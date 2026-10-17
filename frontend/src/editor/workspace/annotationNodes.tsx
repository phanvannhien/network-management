import {
  NodeResizer,
  useReactFlow,
  useStore as useFlowStore,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { GripVertical } from 'lucide-react'
import { memo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { cn } from '@/lib/utils'
import { useLocations, useSites } from '@/modules/sites/sites'
import { atLeast } from '@/modules/sites/access'
import { updateAnnotation } from '../doc/commands'
import { useDoc, useDocStoreApi } from './context'
import { ARROW_PAD } from './frames'

// Annotations on the canvas (P1-19): frames (zones bound to a site / location, ADR-032), text and arrows, plus the
// cluster boxes derived from the inventory. Frames sit under devices and cables; only their title bar takes clicks
// (the body lets the selection box, devices and cables through).

export interface AnnotationData extends Record<string, unknown> {
  annotationId: string
}
export interface ClusterData extends Record<string, unknown> {
  name: string
  kind: string
}

type AnnNode = Node<AnnotationData>

const useAnnotation = (id: string) =>
  useDoc((s) => s.doc?.view.annotations.find((a) => a.id === id))
const useCanEdit = () => useDoc((s) => atLeast(s.meta?.access, 'edit'))

/** Title of a frame: its text, else the bound site (code · name) and location. */
function useFrameTitle(siteId?: string | null, locationId?: string | null, text?: string) {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const sites = useSites(orgId, Boolean(siteId))
  const locations = useLocations(orgId, siteId ?? '')
  if (text) return text
  if (!siteId) return t('frames.untitled')
  const site = sites.data?.find((s) => s.id === siteId)
  if (sites.data && !site) return t('frames.deletedSite')
  const loc = locationId ? locations.data?.find((l) => l.id === locationId) : undefined
  return [site ? `${site.code} · ${site.name}` : '…', loc?.name].filter(Boolean).join(' › ')
}

function FrameNodeImpl({ id, data, selected }: NodeProps<AnnNode>) {
  const { t } = useTranslation()
  const a = useAnnotation(data.annotationId)
  const canEdit = useCanEdit()
  const store = useDocStoreApi()
  const title = useFrameTitle(a?.siteId, a?.locationId, a?.text)
  const zoom = useFlowStore((st) => st.transform[2])
  const scale = zoom < 0.8 ? Math.min(2.5, 0.8 / zoom) : 1
  if (!a) return null
  const color = a.color || 'slate'
  return (
    <div
      className={cn(
        'ntb-frame h-full w-full rounded-md border-2 border-dashed',
        `ntb-zone-${color}`,
      )}
      style={{ pointerEvents: 'none' }}
    >
      <NodeResizer
        isVisible={selected && canEdit}
        minWidth={120}
        minHeight={80}
        lineClassName="ntb-resize-line"
        handleClassName="ntb-resize-handle"
      />
      <button
        type="button"
        className="ntb-frame-title flex max-w-full cursor-move items-center gap-1 rounded-tl-sm rounded-br-md px-2 py-1 text-left text-xs font-semibold"
        aria-label={t('frames.aria', { title })}
        aria-pressed={selected}
        title={t('frames.dragHint')}
        style={{
          pointerEvents: 'auto',
          // Zoomed out, the title keeps a size that can still be grabbed and read.
          transform: scale > 1 ? `scale(${scale})` : undefined,
          maxWidth: scale > 1 ? `${100 / scale}%` : undefined,
          transformOrigin: 'top left',
        }}
        onClick={(e) => {
          // Shift adds the frame to the selection: several sites are then dragged together.
          const st = store.getState()
          if (e.shiftKey)
            st.setSelection(
              st.selection.includes(id)
                ? st.selection.filter((x) => x !== id)
                : [...st.selection, id],
            )
          else st.setSelection([id])
        }}
      >
        <GripVertical aria-hidden className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate">{title}</span>
        {a.siteId && (
          <span className="shrink-0 font-normal text-muted-foreground">
            {a.locationId ? t('frames.location') : t('frames.site')}
          </span>
        )}
      </button>
    </div>
  )
}

const TEXT_COLORS: Record<string, string> = {
  '': 'text-foreground',
  blue: 'text-[#1d4ed8] dark:text-[#93c5fd]',
  green: 'text-[#15803d] dark:text-[#86efac]',
  amber: 'text-[#b45309] dark:text-[#fcd34d]',
  red: 'text-[#b91c1c] dark:text-[#fca5a5]',
  violet: 'text-[#6d28d9] dark:text-[#c4b5fd]',
  slate: 'text-muted-foreground',
}

function TextNodeImpl({ data, selected }: NodeProps<AnnNode>) {
  const { t } = useTranslation()
  const a = useAnnotation(data.annotationId)
  if (!a) return null
  return (
    <div
      className={cn(
        'max-w-md rounded-sm px-1 whitespace-pre-wrap',
        TEXT_COLORS[a.color ?? ''] ?? TEXT_COLORS[''],
        selected && 'ring-2 ring-primary',
      )}
      style={{ fontSize: a.fontSize ?? 14 }}
    >
      {a.text || <span className="text-muted-foreground italic">{t('frames.emptyText')}</span>}
    </div>
  )
}

/** Arrow from (x, y) to points[0] (both absolute); the node box is their bounding box. */
function ArrowNodeImpl({ data, selected }: NodeProps<AnnNode>) {
  const a = useAnnotation(data.annotationId)
  const canEdit = useCanEdit()
  const store = useDocStoreApi()
  const flow = useReactFlow()
  const drag = useRef<{ end: 'start' | 'end'; key: string } | null>(null)
  const [live, setLive] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  if (!a) return null
  const end = a.points?.[0] ?? { x: a.x + 120, y: a.y }
  const p = live ?? { x1: a.x, y1: a.y, x2: end.x, y2: end.y }
  const ox = Math.min(p.x1, p.x2) - ARROW_PAD
  const oy = Math.min(p.y1, p.y2) - ARROW_PAD
  const w = Math.abs(p.x2 - p.x1) + 2 * ARROW_PAD
  const h = Math.abs(p.y2 - p.y1) + 2 * ARROW_PAD
  const color = TEXT_COLORS[a.color ?? ''] ?? TEXT_COLORS['']
  const marker = `arrow-${a.id}`
  const onDown = (which: 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { end: which, key: `arrow:${a.id}:${crypto.randomUUID()}` }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return
    const q = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setLive(
      drag.current.end === 'start'
        ? { x1: q.x, y1: q.y, x2: end.x, y2: end.y }
        : { x1: a.x, y1: a.y, x2: q.x, y2: q.y },
    )
  }
  const onUp = () => {
    if (drag.current && live) {
      store.getState().dispatch(
        updateAnnotation(a.id, {
          x: Math.round(live.x1),
          y: Math.round(live.y1),
          points: [{ x: Math.round(live.x2), y: Math.round(live.y2) }],
        }),
      )
    }
    drag.current = null
    setLive(null)
  }
  return (
    <div className={cn('relative', color)} style={{ width: w, height: h }}>
      <svg width={w} height={h} className="overflow-visible" aria-hidden>
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <line
          x1={p.x1 - ox}
          y1={p.y1 - oy}
          x2={p.x2 - ox}
          y2={p.y2 - oy}
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={a.lineStyle === 'dashed' ? '6 4' : undefined}
          markerEnd={`url(#${marker})`}
        />
      </svg>
      {a.text && (
        <span
          className="pointer-events-none absolute rounded-sm bg-background/85 px-1 text-xs"
          style={{
            left: (p.x1 + p.x2) / 2 - ox,
            top: (p.y1 + p.y2) / 2 - oy,
            transform: 'translate(-50%, -120%)',
          }}
        >
          {a.text}
        </span>
      )}
      {selected &&
        canEdit &&
        (['start', 'end'] as const).map((which) => (
          <span
            key={which}
            className="nodrag nopan absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-primary bg-background"
            style={{
              left: (which === 'start' ? p.x1 : p.x2) - ox,
              top: (which === 'start' ? p.y1 : p.y2) - oy,
            }}
            onPointerDown={onDown(which)}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        ))}
    </div>
  )
}

function ClusterNodeImpl({ data }: NodeProps<Node<ClusterData>>) {
  const { t } = useTranslation()
  const short = data.kind.startsWith('ha')
    ? 'HA'
    : data.kind === 'stack'
      ? 'Stack'
      : t('frames.cluster')
  return (
    <div className="ntb-cluster pointer-events-none h-full w-full rounded-lg border-2 border-dotted">
      <span className="ntb-cluster-label absolute top-1 left-2 rounded-sm px-1 text-[10px] font-semibold">
        {short} · {data.name}
      </span>
    </div>
  )
}

export const FrameNode = memo(FrameNodeImpl)
export const TextNode = memo(TextNodeImpl)
export const ArrowNode = memo(ArrowNodeImpl)
export const ClusterNode = memo(ClusterNodeImpl)
