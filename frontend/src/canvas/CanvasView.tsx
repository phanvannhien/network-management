import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceType } from '../types/ntb'
import { newId } from '../model/factory'
import { addPage, setNodePosition } from '../model/commands'
import { useAppStore } from '../model/store'
import { buildEdges, buildNodes, firstPageId } from './adapters'
import { DeviceNode } from './DeviceNode'
import { deviceDropCommand } from './dropDevice'
import { DEVICE_MIME } from '../panels/Palette'

const GRID_SIZES = [10, 20, 40] as const

/** Ensures the document always has at least one page to draw on. */
function useEnsurePage() {
  const pageId = useAppStore((s) => firstPageId(s.data))
  const dispatch = useAppStore((s) => s.dispatch)
  useEffect(() => {
    if (pageId === null) {
      dispatch(addPage({ id: newId(), name: 'Page 1', layer: 'physical', nodes: [], edges: [] }))
    }
  }, [pageId, dispatch])
  return pageId
}

function CanvasInner() {
  const pageId = useEnsurePage()
  const data = useAppStore((s) => s.data)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridSize, setGridSize] = useState<number>(20)
  const { fitView, screenToFlowPosition } = useReactFlow()

  const nodes = useMemo(() => (pageId ? buildNodes(data, pageId) : []), [data, pageId])
  const edges = useMemo(() => (pageId ? buildEdges(data, pageId) : []), [data, pageId])

  // Shift+1 → Fit to screen (SRS §3)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === '1') {
        e.preventDefault()
        void fitView({ padding: 0.2, duration: 200 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!pageId) return
      const { dispatch } = useAppStore.getState()
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        // Consecutive drag moves share a mergeKey → one undo step per drag (SRS §3).
        dispatch(
          setNodePosition(
            pageId,
            change.id,
            change.position.x,
            change.position.y,
            `drag:${change.id}`,
          ),
        )
      }
    },
    [pageId],
  )

  if (!pageId) return null

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DEVICE_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: React.DragEvent) => {
    const typeId = e.dataTransfer.getData(DEVICE_MIME)
    if (!typeId || !pageId) return
    e.preventDefault()
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const { data, dispatch } = useAppStore.getState()
    dispatch(deviceDropCommand(data, pageId, typeId as DeviceType, position.x, position.y))
  }

  return (
    <div className="relative h-full w-full">
      {/* Toolbar overlay: grid snap toggle + grid size (SRS §3: lưới 10/20/40 px) */}
      <div className="bg-popover absolute top-3 left-3 z-10 flex items-center gap-3 rounded-md border border-border px-3 py-1.5 text-xs shadow-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          Snap to grid
        </label>
        <select
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          className="rounded border border-border bg-background px-1 py-0.5"
          aria-label="Grid size"
        >
          {GRID_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.2, duration: 200 })}
          className="rounded border border-border px-2 py-0.5 hover:bg-accent"
          title="Fit to screen (Shift+1)"
        >
          Fit
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ device: DeviceNode }}
        onNodesChange={onNodesChange}
        onDragOver={onDragOver}
        onDrop={onDrop}
        minZoom={0.1}
        maxZoom={4}
        snapToGrid={snapEnabled}
        snapGrid={[gridSize, gridSize]}
        panOnDrag
        panActivationKeyCode="Space"
        selectionOnDrag
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={gridSize} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-background" />
      </ReactFlow>
    </div>
  )
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
