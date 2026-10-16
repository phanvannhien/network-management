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
import { ArrowLeft, Lock, LockOpen, Magnet, Maximize } from 'lucide-react'
import { Link } from 'react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { Button, buttonVariants } from '@/components/ui/button'
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
import i18n from '@/i18n'

const GRID_SIZES = [10, 20, 40] as const

// Stable edge/node type maps — recreating them per render triggers React Flow warnings.
const EDGE_TYPES = { link: LinkEdge }

/** Ensures the document always has at least one page to draw on. */
function useEnsurePage() {
  const pageId = useAppStore((s) => firstPageId(s.data))
  const dispatch = useAppStore((s) => s.dispatch)
  useEffect(() => {
    if (pageId === null) {
      dispatch(
        addPage({
          id: newId(),
          name: i18n.t('editor.page'),
          layer: 'physical',
          nodes: [],
          edges: [],
        }),
      )
    }
  }, [pageId, dispatch])
  return pageId
}

/** Toolbar button toggling lock on the current selection (Ctrl+L). */
function LockButton({ pageId }: { pageId: string }) {
  const { t } = useTranslation()
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
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={selection.length === 0}
      title={t('editor.lockHint')}
      aria-keyshortcuts="Control+L"
    >
      {locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
      {locked ? t('editor.unlock') : t('editor.lock')}
    </Button>
  )
}

function CanvasInner() {
  const { t } = useTranslation()
  const pageId = useEnsurePage()
  const data = useAppStore((s) => s.data)
  const selection = useAppStore((s) => s.selection)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridSize, setGridSize] = useState<number>(20)
  const [pending, setPending] = useState<PendingConnection | null>(null)
  const connectionSource = useRef<string | null>(null)
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow()
  const ariaLabels = useMemo(
    () => ({
      'node.a11yDescription.default': t('editor.rf.node'),
      'node.a11yDescription.keyboardDisabled': t('editor.rf.nodeKeyboard'),
      'node.a11yDescription.ariaLiveMessage': (p: { direction: string; x: number; y: number }) =>
        t('editor.rf.moved', p),
      'edge.a11yDescription.default': t('editor.rf.edge'),
      'controls.ariaLabel': t('editor.rf.controls'),
      'controls.zoomIn.ariaLabel': t('editor.rf.zoomIn'),
      'controls.zoomOut.ariaLabel': t('editor.rf.zoomOut'),
      'controls.fitView.ariaLabel': t('editor.rf.fitView'),
      'controls.interactive.ariaLabel': t('editor.rf.interactive'),
      'minimap.ariaLabel': t('editor.rf.minimap'),
      'handle.ariaLabel': t('editor.rf.handle'),
    }),
    [t],
  )
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

  // Measured node sizes are view state (not part of the document): React Flow needs them for the
  // minimap and fitView of controlled nodes.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const nodes = useMemo(
    () =>
      pageId
        ? buildNodes(data, pageId, selection).map((n) =>
            measured[n.id] ? { ...n, measured: measured[n.id] } : n,
          )
        : [],
    [data, pageId, selection, measured],
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
      const sizes: Record<string, { width: number; height: number }> = {}
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions) sizes[change.id] = change.dimensions

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
      if (Object.keys(sizes).length > 0) setMeasured((m) => ({ ...m, ...sizes }))
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
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1" aria-label={t('editor.canvas')} role="region">
        {/* Floating toolbar: grid snap + grid size (SRS §3: lưới 10/20/40 px), fit, lock. */}
        <div
          role="toolbar"
          aria-label={t('editor.toolbar')}
          className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-sm"
        >
          <Link to="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeft aria-hidden /> {t('editor.back')}
          </Link>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button
            variant={snapEnabled ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={snapEnabled}
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            <Magnet aria-hidden /> {t('editor.snap')}
          </Button>
          <span className="w-20">
            <NativeSelect
              value={gridSize}
              onChange={(e) => setGridSize(Number(e.target.value))}
              aria-label={t('editor.gridSize')}
              className="h-7"
            >
              {GRID_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </NativeSelect>
          </span>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fitView({ padding: 0.2, duration: 200 })}
            title={t('editor.fitHint')}
            aria-keyshortcuts="Shift+1"
          >
            <Maximize aria-hidden /> {t('editor.fit')}
          </Button>
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
          ariaLabelConfig={ariaLabels}
        >
          <Background variant={BackgroundVariant.Dots} gap={gridSize} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {pending && <LinkDialog pending={pending} pageId={pageId} onClose={() => setPending(null)} />}
      {/* Below the canvas (not over it) so it never hides the controls or the minimap. */}
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
