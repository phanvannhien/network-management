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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceType } from '../../types/ntb'
import { compound, setNodeLocked } from '../model/commands'
import { newId } from '../model/factory'
import { addPage, setNodePosition } from '../model/commands'
import { useAppStore } from '../model/store'
import { buildEdges, buildNodes, firstPageId } from './adapters'
import { DeviceNode } from './DeviceNode'
import { deviceDropCommand } from './dropDevice'
import { useCanvasShortcuts } from './useCanvasShortcuts'
import { LinkDialog, type PendingConnection } from './LinkDialog'
import { LinkEdge } from './LinkEdge'
import { useValidation } from '../validation/useValidation'
import { Problems } from '../panels/Problems'
import { DEVICE_MIME } from '../panels/Palette'

const GRID_SIZES = [10, 20, 40] as const

// Stable edge/node type maps — recreating them per render triggers React Flow warnings.
const EDGE_TYPES = { link: LinkEdge }

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

/** Toolbar button toggling lock on the current selection (Ctrl+L). */
function LockButton({ pageId }: { pageId: string }) {
  const selection = useAppStore((s) => s.selection)
  const nodes = useAppStore((s) => s.data.pages[pageId]?.nodes)

  const locked = useMemo(
    () => selection.some((id) => nodes?.find((n) => n.refId === id)?.locked ?? false),
    [selection, nodes],
  )

  const onClick = () => {
    const s = useAppStore.getState()
    if (s.selection.length === 0) return
    s.dispatch(compound(...s.selection.map((id) => setNodeLocked(pageId, id, !locked))))
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={selection.length === 0}
      className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40"
      title="Lock/unlock selection (Ctrl+L)"
    >
      {locked ? 'Unlock' : 'Lock'}
    </button>
  )
}

function CanvasInner() {
  const pageId = useEnsurePage()
  const data = useAppStore((s) => s.data)
  const selection = useAppStore((s) => s.selection)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridSize, setGridSize] = useState<number>(20)
  const [pending, setPending] = useState<PendingConnection | null>(null)
  const connectionSource = useRef<string | null>(null)
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow()
  useCanvasShortcuts(pageId)
  useValidation()
  const focusTarget = useAppStore((s) => s.focusTarget)

  // Problem panel click → zoom to the object (SRS §6).
  useEffect(() => {
    if (!focusTarget || !pageId) return
    const { data } = useAppStore.getState()
    if (focusTarget.kind === 'device') {
      const node = data.pages[pageId]?.nodes.find((n) => n.refId === focusTarget.id)
      if (node) void setCenter(node.x + 56, node.y + 60, { zoom: 1, duration: 300 })
    } else {
      const link = data.links[focusTarget.id]
      if (link) {
        void fitView({
          nodes: [{ id: link.a.deviceId }, { id: link.b.deviceId }],
          duration: 300,
          maxZoom: 1.5,
          padding: 0.4,
        })
      }
    }
  }, [focusTarget, pageId, setCenter, fitView])

  const nodes = useMemo(
    () => (pageId ? buildNodes(data, pageId, selection) : []),
    [data, pageId, selection],
  )
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
      const { dispatch, setSelection, selection: current } = useAppStore.getState()
      const selectionChanges = new Map<string, boolean>()
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
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
        } else if (change.type === 'select') {
          selectionChanges.set(change.id, change.selected)
        }
      }
      if (selectionChanges.size > 0) {
        const next = new Set(current)
        for (const [id, selected] of selectionChanges) {
          if (selected) next.add(id)
          else next.delete(id)
        }
        setSelection([...next])
      }
    },
    [pageId],
  )

  const onConnectStart = useCallback((_event: unknown, params: { nodeId?: string | null }) => {
    connectionSource.current = params.nodeId ?? null
  }, [])

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const sourceId = connectionSource.current
      connectionSource.current = null
      if (!sourceId || !pageId) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const element = document.elementFromPoint(point.clientX, point.clientY)
      const nodeElement = element?.closest('.react-flow__node')
      const targetId = nodeElement?.getAttribute('data-id')
      if (!targetId || targetId === sourceId) return
      if (!useAppStore.getState().data.devices[targetId]) return
      setPending({ sourceId, targetId })
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
        <LockButton pageId={pageId} />
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ device: DeviceNode }}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
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
      {pending && <LinkDialog pending={pending} pageId={pageId} onClose={() => setPending(null)} />}
      <Problems />
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
