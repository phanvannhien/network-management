import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  SelectionMode,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { moveNodes } from '../doc/commands'
import { useDoc, useDocStoreApi } from './context'
import { FIT_OPTIONS, MAX_ZOOM, MIN_ZOOM, toFlowEdges, toFlowNodes, type RefData } from './flow'
import { NODE_TYPES } from './nodes'
import type { EditorPrefs } from './prefs'

/**
 * The diagram canvas (P1-14, SRS §6.1): React Flow over the document store. Dragging sends move commands (one undo
 * step per drag); selection and viewport are editor state, not history. Panning: Space + drag or the middle button;
 * dragging on the background draws a selection box.
 */
export function Canvas({ canEdit, prefs }: { canEdit: boolean; prefs: EditorPrefs }) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const doc = useDoc((s) => s.doc)
  const selection = useDoc((s) => s.selection)
  const [initialViewport] = useState(() => store.getState().viewport)
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const [dataCache] = useState(() => new Map<string, RefData>())
  const dragKey = useRef<string | null>(null)

  const nodes = useMemo(() => {
    if (!doc) return []
    const selected = new Set(selection)
    return toFlowNodes(doc, selected).map((n) => {
      // Stable data objects keep memoized nodes from re-rendering when another node moves.
      const cached = dataCache.get(n.id)
      const data =
        cached && cached.refId === n.data.refId && cached.refKind === n.data.refKind
          ? cached
          : n.data
      dataCache.set(n.id, data)
      return { ...n, data, draggable: canEdit && n.draggable, measured: measured[n.id] }
    })
  }, [doc, selection, measured, canEdit, dataCache])
  const edges = useMemo(() => (doc ? toFlowEdges(doc) : []), [doc])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const { dispatch, setSelection, selection: current } = store.getState()
      const moves: { id: string; x: number; y: number }[] = []
      const picked = new Map<string, boolean>()
      const sizes: Record<string, { width: number; height: number }> = {}
      for (const c of changes) {
        if (c.type === 'position' && c.position && canEdit)
          moves.push({ id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) })
        else if (c.type === 'select') picked.set(c.id, c.selected)
        else if (c.type === 'dimensions' && c.dimensions) sizes[c.id] = c.dimensions
      }
      if (moves.length > 0) dispatch(moveNodes(moves, dragKey.current ?? undefined))
      if (picked.size > 0) {
        const next = new Set(current)
        for (const [id, on] of picked) {
          if (on) next.add(id)
          else next.delete(id)
        }
        setSelection([...next])
      }
      if (Object.keys(sizes).length > 0) setMeasured((m) => ({ ...m, ...sizes }))
    },
    [store, canEdit],
  )

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

  return (
    <ReactFlow
      aria-label={t('editorCanvas.canvas')}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeDragStart={() => {
        dragKey.current = `drag:${crypto.randomUUID()}`
      }}
      onNodeDragStop={() => {
        dragKey.current = null
      }}
      onMoveEnd={(_e, vp: Viewport) => store.getState().setViewport(vp)}
      defaultViewport={initialViewport ?? undefined}
      fitView={!initialViewport}
      fitViewOptions={FIT_OPTIONS}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      snapToGrid={prefs.snap}
      snapGrid={[prefs.grid, prefs.grid]}
      nodesDraggable={canEdit}
      nodesConnectable={false}
      elementsSelectable
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      panOnDrag={[1]}
      panActivationKeyCode="Space"
      multiSelectionKeyCode="Shift"
      selectionKeyCode={null}
      deleteKeyCode={null}
      zoomOnDoubleClick={false}
      onlyRenderVisibleElements
      ariaLabelConfig={ariaLabels}
    >
      <Background variant={BackgroundVariant.Dots} gap={prefs.grid} size={1.5} />
      {prefs.minimap && <MiniMap pannable zoomable position="bottom-right" />}
    </ReactFlow>
  )
}
