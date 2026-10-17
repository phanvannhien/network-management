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
import { borderPoint } from '../workspace/flow'

// The links between two sites on an overview, as one read-only edge (P2-21, ADR-040): derived from the inventory, never
// stored, never selected. Solid = dedicated circuit / cable, dashed = VPN, dotted = radio / mobile.

export interface SiteEdgeData extends Record<string, unknown> {
  label: string
  style: 'dedicated' | 'vpn' | 'wireless' | 'other'
  links: number
}

function rectOf(n: InternalNode) {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? 184,
    h: n.measured.height ?? 112,
  }
}

function SiteEdgeImpl({ id, source, target, data }: EdgeProps<Edge<SiteEdgeData>>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const showLabel = useFlowStore((s) => s.transform[2] >= 0.35)
  if (!a || !b) return null
  const ra = rectOf(a)
  const rb = rectOf(b)
  const p1 = borderPoint(ra, { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 })
  const p2 = borderPoint(rb, { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 })
  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${p1.x},${p1.y} L ${p2.x},${p2.y}`}
        className={`ntb-site-edge-${data?.style ?? 'other'}`}
      />
      {showLabel && data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-sm border border-border bg-background px-1 text-[10px]"
            style={{
              transform: `translate(-50%, -50%) translate(${(p1.x + p2.x) / 2}px, ${(p1.y + p2.y) / 2}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const SiteEdge = memo(SiteEdgeImpl)
