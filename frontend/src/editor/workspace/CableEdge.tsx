import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useStore as useFlowStore,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { borderPoint, parallelOffset, type Pt } from './flow'
import { shortPort } from './wiring'

// A cable on the canvas (P1-17): a straight line between the borders of the two nodes (not fixed handles), parallel
// cables between the same pair spread apart, port names near each end (hidden below 50 % zoom, SRS §6.3).

export interface CableData extends Record<string, unknown> {
  linkId: string
  aPort: string
  bPort: string
  status: 'up' | 'down' | 'planned'
  /** Position among the cables of the same node pair, and their count. */
  index: number
  count: number
  /** An endpoint group's cables to one device drawn as this one edge (ADR-036): every link id, this one first. */
  bundle?: string[]
}

export type CableFlowEdge = Edge<CableData>

function rectOf(n: InternalNode): { x: number; y: number; w: number; h: number } {
  const w = n.measured.width ?? 144
  const h = n.measured.height ?? 80
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h }
}

function CableEdgeImpl({
  id,
  source,
  target,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps<CableFlowEdge>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const showLabels = useFlowStore((s) => s.transform[2] >= 0.5)
  if (!a || !b) return null
  const ra = rectOf(a)
  const rb = rectOf(b)
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 }
  const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 }
  // Offset both centres sideways for parallel cables, then clip to the borders.
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1
  const off = parallelOffset(data?.index ?? 0, data?.count ?? 1)
  // Keep the side stable whichever way the pair is ordered.
  const sign = source < target ? 1 : -1
  const nx = (-(cb.y - ca.y) / len) * off * sign
  const ny = ((cb.x - ca.x) / len) * off * sign
  const p1 = borderPoint(ra, { x: cb.x + nx, y: cb.y + ny })
  const p2 = borderPoint(rb, { x: ca.x + nx, y: ca.y + ny })
  const s = { x: p1.x + nx, y: p1.y + ny }
  const t = { x: p2.x + nx, y: p2.y + ny }
  const path = `M ${s.x},${s.y} L ${t.x},${t.y}`
  // Port labels a little inside each end.
  const at = (p: Pt, q: Pt, d: number) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d }
  }
  const la = at(s, t, 28)
  const lb = at(t, s, 28)
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 16}
      />
      {(showLabels || data?.status === 'down') && (
        <EdgeLabelRenderer>
          {showLabels && data?.aPort && (
            <PortLabel text={shortPort(data.aPort)} x={la.x} y={la.y} />
          )}
          {showLabels && data?.bPort && (
            <PortLabel text={shortPort(data.bPort)} x={lb.x} y={lb.y} />
          )}
          {/* Colour is never the only signal (DESIGN.md): a down / planned cable says so in words. */}
          {data && data.status !== 'up' && (
            <StatusBadge status={data.status} x={(s.x + t.x) / 2} y={(s.y + t.y) / 2} />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

function StatusBadge({ status, x, y }: { status: 'down' | 'planned'; x: number; y: number }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'nodrag nopan pointer-events-none absolute rounded-sm border bg-background px-1 text-[10px] font-medium',
        status === 'down'
          ? 'border-status-down text-status-down'
          : 'border-border-control text-muted-foreground',
      )}
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {status === 'down' ? `✕ ${t('cable.down')}` : t('cable.planned')}
    </div>
  )
}

function PortLabel({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute rounded-sm bg-background/85 px-1 font-mono text-[10px] text-muted-foreground"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {text}
    </div>
  )
}

export const CableEdge = memo(CableEdgeImpl)
