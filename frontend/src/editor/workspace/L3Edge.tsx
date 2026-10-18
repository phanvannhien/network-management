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
import { borderPoint } from './flow'

// Lines of an L3 page (P2-08): a device's interface IP down to its subnet bar (attach), or a transit /30 between two
// routers (p2p). Derived from IPAM, never selected or edited on the canvas.

export interface L3EdgeData extends Record<string, unknown> {
  kind: 'attach' | 'p2p'
  /** attach: "vlan20 .1"; p2p: the subnet, e.g. 10.0.0.0/30. */
  label: string
  /** attach: the IP is the subnet's gateway. */
  gateway?: boolean
  /** p2p: host parts at each end (".1", ".2"). */
  aHost?: string
  bHost?: string
}

export type L3FlowEdge = Edge<L3EdgeData>

function rectOf(n: InternalNode) {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? 144,
    h: n.measured.height ?? 80,
  }
}

function Label({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded-sm bg-background/90 px-1 font-mono text-[10px]"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {children}
    </div>
  )
}

function L3EdgeImpl({ id, source, target, data }: EdgeProps<L3FlowEdge>) {
  const { t } = useTranslation()
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const showLabels = useFlowStore((s) => s.transform[2] >= 0.5)
  if (!a || !b || !data) return null
  const ra = rectOf(a)
  const rb = rectOf(b)
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 }
  if (data.kind === 'attach') {
    // Straight down (or up) onto the bar, under the device as far as the bar reaches.
    const x = Math.min(Math.max(ca.x, rb.x + 12), rb.x + rb.w - 12)
    const above = ca.y < rb.y
    const end = { x, y: above ? rb.y : rb.y + rb.h }
    const start = borderPoint(ra, end)
    const path = `M ${start.x},${start.y} L ${end.x},${end.y}`
    const lx = end.x
    const ly = above ? end.y - 12 : end.y + 12
    return (
      <>
        <BaseEdge id={id} path={path} style={{ strokeWidth: 2 }} />
        {showLabels && (data.label || data.gateway) && (
          <EdgeLabelRenderer>
            <Label x={lx} y={ly}>
              {data.label}
              {data.gateway && (
                <span
                  className="rounded-sm border border-border px-0.5 font-sans font-semibold"
                  title={t('l3.gatewayHint')}
                >
                  GW
                </span>
              )}
            </Label>
          </EdgeLabelRenderer>
        )}
      </>
    )
  }
  const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 }
  const s = borderPoint(ra, cb)
  const e = borderPoint(rb, ca)
  const path = `M ${s.x},${s.y} L ${e.x},${e.y}`
  const at = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d }
  }
  const la = at(s, e, 22)
  const lb = at(e, s, 22)
  // A short line has room for the subnet only.
  const roomy = Math.hypot(e.x - s.x, e.y - s.y) >= 200
  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeWidth: 2.5 }} />
      {showLabels && (
        <EdgeLabelRenderer>
          <Label x={(s.x + e.x) / 2} y={(s.y + e.y) / 2}>
            {data.label}
          </Label>
          {roomy && data.aHost && (
            <Label x={la.x} y={la.y}>
              {data.aHost}
            </Label>
          )}
          {roomy && data.bHost && (
            <Label x={lb.x} y={lb.y}>
              {data.bHost}
            </Label>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const L3Edge = memo(L3EdgeImpl)
