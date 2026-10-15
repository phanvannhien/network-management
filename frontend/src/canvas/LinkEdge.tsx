import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type EdgeProps } from '@xyflow/react'

export interface LinkEdgeData extends Record<string, unknown> {
  sourceLabel: string
  targetLabel: string
  speed: string
}

interface LinkEdgeProps extends EdgeProps {
  pathOptions?: { curvature?: number }
}

/**
 * Custom link edge (SRS §4): port names at both ends, speed in the middle.
 * Secondary labels hide below 50% zoom (SRS §4: ẩn label phụ khi zoom < 50%).
 */
export function LinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  pathOptions,
  style,
  markerEnd,
}: LinkEdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: pathOptions?.curvature ?? 0.25,
  })
  const showLabels = useStore((s) => s.transform[2] >= 0.5)
  const linkData = (data ?? {}) as Partial<LinkEdgeData>

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {showLabels && (
        <EdgeLabelRenderer>
          <EdgeLabel text={linkData.sourceLabel ?? ''} x={sourceX} y={sourceY - 14} />
          <EdgeLabel text={linkData.targetLabel ?? ''} x={targetX} y={targetY - 14} />
          {(linkData.speed ?? '') !== '' && (
            <EdgeLabel text={linkData.speed ?? ''} x={labelX} y={labelY} />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

function EdgeLabel({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute rounded bg-background/80 px-1 text-[10px] text-muted-foreground"
      style={{
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
      }}
    >
      {text}
    </div>
  )
}
