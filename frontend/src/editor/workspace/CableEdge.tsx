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
import { useDoc } from './context'
import { portLabel } from './wiring'
import {
  countVlans,
  formatVlanSet,
  vlanIds,
  vlanInfo,
  type DiagramVlan,
  type L2Edge,
  type VlanInfo,
} from '../l2/l2'

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
  /** L2 view (P2-08): what the cable carries, and the site its VLAN names are read from. */
  l2?: L2Edge
  siteId?: string
  /** L2 view: the LAG whose member cables this edge draws, and how many. */
  lag?: string
  lagCount?: number
  /** L1: this cable draws the ring across a LAG's member cables (indexes from–to among the pair's cables). */
  ring?: string
  ringFrom?: number
  ringTo?: number
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
  const portStyle = useDoc((s) => s.doc?.view.portStyle) ?? 'compact'
  const vlans = useDoc((s) => s.doc?.vlans) ?? NO_VLANS
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
  const l2 = data?.l2
  const accessVlan =
    l2?.kind === 'access' && l2.vlans !== 'all' && l2.vlans[0]
      ? vlanInfo(l2.vlans[0][0], data?.siteId, vlans)
      : null
  const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }
  // L1: a ring across the LAG's member cables, centred between the first and the last one.
  const ring = data?.ring
    ? (() => {
        const count = data.count ?? 1
        const o1 = parallelOffset(data.ringFrom ?? 0, count) - off
        const o2 = parallelOffset(data.ringTo ?? 0, count) - off
        const c = (o1 + o2) / 2
        const ux = (t.x - s.x) / (Math.hypot(t.x - s.x, t.y - s.y) || 1)
        const uy = (t.y - s.y) / (Math.hypot(t.x - s.x, t.y - s.y) || 1)
        const px = -uy * sign
        const py = ux * sign
        return {
          cx: mid.x + px * c,
          cy: mid.y + py * c,
          rx: Math.abs(o2 - o1) / 2 + 8,
          angle: (Math.atan2(py, px) * 180) / Math.PI,
          name: data.ring,
        }
      })()
    : null
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={
          accessVlan
            ? {
                ...style,
                stroke: accessVlan.color,
                // Not in IPAM: grey and dashed, never mistaken for a VLAN whose colour is grey.
                ...(accessVlan.unknown && { strokeDasharray: '6 3' }),
              }
            : style
        }
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 16}
      />
      {ring && (
        <ellipse
          className="pointer-events-none fill-none stroke-foreground"
          strokeWidth={1.5}
          cx={ring.cx}
          cy={ring.cy}
          rx={ring.rx}
          ry={10}
          transform={`rotate(${ring.angle} ${ring.cx} ${ring.cy})`}
        />
      )}
      {(showLabels || data?.status === 'down' || (l2 && l2.issues.length > 0)) && (
        <EdgeLabelRenderer>
          {showLabels && ring && <LagLabel name={ring.name} x={ring.cx} y={ring.cy - 18} />}
          {l2 && (
            <L2Label
              facts={l2}
              lag={data?.lag ? { name: data.lag, count: data.lagCount ?? 1 } : undefined}
              access={accessVlan}
              siteId={data?.siteId}
              vlans={vlans}
              showText={showLabels}
              x={mid.x}
              y={mid.y + (data?.status !== 'up' ? 16 : 0)}
            />
          )}
          {showLabels && data?.aPort && (
            <PortLabel text={portLabel(data.aPort, portStyle)} x={la.x} y={la.y} />
          )}
          {showLabels && data?.bPort && (
            <PortLabel text={portLabel(data.bPort, portStyle)} x={lb.x} y={lb.y} />
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

const NO_VLANS: DiagramVlan[] = []
/** Coloured squares on a trunk: the first VLANs it carries, then "+N". */
const MAX_CHIPS = 6

function L2Label({
  facts,
  lag,
  access,
  siteId,
  vlans,
  showText,
  x,
  y,
}: {
  facts: L2Edge
  lag?: { name: string; count: number }
  access: VlanInfo | null
  siteId?: string
  vlans: readonly DiagramVlan[]
  showText: boolean
  x: number
  y: number
}) {
  const { t } = useTranslation()
  const warnings = facts.issues.filter((i) => i.level === 'warning')
  const infos = facts.issues.filter((i) => i.level === 'info')
  const say = (list: L2Edge['issues']) =>
    list.map((i) =>
      t(`l2.issue.${i.key}` as 'l2.issue.accessDiffers', i.values as { a: string; b: string }),
    )
  const lagText =
    lag && lag.count > 1 ? `${lag.name} · ${t('l2.cables', { count: lag.count })} · ` : ''
  let text = ''
  let chips: VlanInfo[] = []
  let more = 0
  if (facts.kind === 'access')
    text = access
      ? `VLAN ${access.vid}${access.name ? ` ${access.name}` : ` (${t('l2.notInIpam')})`}`
      : t('l2.accessNoVlan')
  else if (facts.kind === 'trunk') {
    const ids = vlanIds(facts.vlans, MAX_CHIPS + 1)
    chips = ids.slice(0, MAX_CHIPS).map((v) => vlanInfo(v, siteId, vlans))
    more = facts.vlans === 'all' ? 0 : countVlans(facts.vlans) - chips.length
    const list = facts.unspecified ? 'ALL?' : formatVlanSet(facts.vlans)
    text = `${facts.hybrid ? 'Hybrid' : 'Trunk'} ${list}${facts.native ? ` · native ${facts.native}` : ''}`
  } else if (facts.kind === 'routed') text = t('l2.routed')
  else text = t('l2.unset')
  if (!showText && facts.issues.length === 0) return null
  return (
    <div
      className="nodrag nopan absolute flex items-center gap-1 rounded-sm border border-border bg-background/90 px-1 text-[10px] leading-4"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {/* Colour is never the only signal: each mark has a symbol, its text in the tooltip and for screen readers. */}
      {warnings.length > 0 && (
        <IssueMark symbol="⚠" className="text-status-warning" texts={say(warnings)} />
      )}
      {infos.length > 0 && (
        <IssueMark symbol="ⓘ" className="text-muted-foreground" texts={say(infos)} />
      )}
      {showText && (
        <span
          className="pointer-events-none flex items-center gap-1"
          title={facts.unspecified ? t('l2.unspecifiedHint') : undefined}
        >
          {access && (
            <span
              className={cn(
                'size-2 rounded-full',
                access.unknown && 'border border-dashed border-muted-foreground',
              )}
              style={{ background: access.unknown ? 'transparent' : access.color }}
              aria-hidden
            />
          )}
          {chips.map((c) => (
            <span
              key={c.vid}
              className="size-2 rounded-[2px]"
              style={{ background: c.color }}
              aria-hidden
            />
          ))}
          {more > 0 && <span className="text-muted-foreground">+{more}</span>}
          <span className="font-mono">
            {lagText}
            {text}
          </span>
        </span>
      )}
    </div>
  )
}

function IssueMark({
  symbol,
  className,
  texts,
}: {
  symbol: string
  className: string
  texts: string[]
}) {
  return (
    <span
      className={cn('pointer-events-auto cursor-help font-semibold', className)}
      title={texts.join('\n')}
      aria-label={texts.join('. ')}
      role="img"
    >
      {symbol}
    </span>
  )
}

function LagLabel({ name, x, y }: { name: string; x: number; y: number }) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute rounded-sm bg-background/85 px-1 font-mono text-[10px] font-semibold"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {name}
    </div>
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
