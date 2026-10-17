import { useReactFlow } from '@xyflow/react'
import { useRef, useState, type PointerEvent } from 'react'

export interface FlowRect {
  x: number
  y: number
  w: number
  h: number
}

/** Smallest frame worth drawing (flow units); a plain click makes nothing. */
const MIN = 40

/**
 * Frame tool (P1-19 feedback): the canvas takes a crosshair, the user drags the frame's rectangle, release creates it.
 * A layer over the canvas catches the drag so nothing underneath is selected or moved meanwhile.
 */
export function FrameDrawLayer({ onDone }: { onDone: (r: FlowRect) => void }) {
  const flow = useReactFlow()
  const layer = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const local = (e: PointerEvent) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    start.current = local(e)
    setBox({ ...start.current, w: 0, h: 0 })
  }
  const move = (e: PointerEvent) => {
    if (!start.current) return
    const p = local(e)
    const s = start.current
    setBox({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    })
  }
  const up = (e: PointerEvent) => {
    if (!start.current || !box) return
    start.current = null
    setBox(null)
    const r = layer.current!.getBoundingClientRect()
    const a = flow.screenToFlowPosition({ x: r.left + box.x, y: r.top + box.y })
    const b = flow.screenToFlowPosition({ x: r.left + box.x + box.w, y: r.top + box.y + box.h })
    void e
    if (b.x - a.x < MIN || b.y - a.y < MIN) return
    onDone({
      x: Math.round(a.x),
      y: Math.round(a.y),
      w: Math.round(b.x - a.x),
      h: Math.round(b.y - a.y),
    })
  }

  return (
    <div
      ref={layer}
      data-testid="frame-draw-layer"
      className="absolute inset-0 z-[5] cursor-crosshair"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      {box && (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary bg-primary/5"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
    </div>
  )
}
