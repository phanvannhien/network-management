import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ConnectionMode,
  SelectionMode,
  useReactFlow,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { moveAnnotation, moveNodes, updateAnnotation } from '../doc/commands'
import { decodeItem, LIBRARY_MIME, type LibraryItem } from '../library/items'
import { useDoc, useDocStoreApi } from './context'
import {
  ANN,
  fitOptions,
  isAnnotationId,
  isOverlayId,
  MAX_ZOOM,
  MIN_ZOOM,
  toAnnotationNodes,
  toClusterNodes,
  toFlowEdges,
  toFlowNodes,
  type RefData,
} from './flow'
import { arrowOrigin, clusterBoxes, nodesInFrame } from './frames'
import { EDGE_TYPES, NODE_TYPES } from './nodeTypes'
import type { EditorPrefs } from './prefs'

const VIEWPORT_KEY = (diagramId: string) => `ntb-viewport:${diagramId}`

/** Where this user last looked at this diagram (per browser), else the view saved with the diagram. */
function startViewport(diagramId: string, saved: Viewport | null): Viewport | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWPORT_KEY(diagramId)) ?? 'null') as Viewport | null
    if (v && [v.x, v.y, v.zoom].every(Number.isFinite)) return v
  } catch {
    // ignore broken entries
  }
  return saved
}

/**
 * The diagram canvas (P1-14, SRS §6.1): React Flow over the document store. Dragging sends move commands (one undo
 * step per drag); selection and viewport are editor state, not history. Scrolling (two fingers on a trackpad) moves
 * the view, Ctrl + scroll or pinching zooms; Space + drag or the middle button pans too; dragging on the background
 * draws a selection box. Library items dropped here are placed where they land (P1-15).
 */
export function Canvas({
  diagramId,
  canEdit,
  prefs,
  libraryOpen,
  onDropItem,
  onWire,
  wiring,
  onNodePick,
  onEditCable,
  onMenu,
}: {
  diagramId: string
  canEdit: boolean
  prefs: EditorPrefs
  /** The library covers the left of the canvas. */
  libraryOpen: boolean
  onDropItem: (item: LibraryItem, at: { x: number; y: number }) => void
  /** A cable drawn from one node to another (drag from a connection point, or connect mode). */
  onWire: (sourceNodeId: string, targetNodeId: string) => void
  /** Connect mode (L): clicks pick the two ends instead of selecting. */
  wiring: boolean
  onNodePick: (nodeId: string) => void
  /** Double click on a cable: edit it. */
  onEditCable: (edgeId: string) => void
  /** Right click on a node, a cable or the background (screen coordinates). */
  onMenu: (target: { kind: 'node' | 'edge' | 'pane'; id?: string }, x: number, y: number) => void
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const flow = useReactFlow()
  const doc = useDoc((s) => s.doc)
  const selection = useDoc((s) => s.selection)
  const [initialViewport] = useState(() => startViewport(diagramId, store.getState().viewport))
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const [dataCache] = useState(() => new Map<string, RefData>())
  const dragKey = useRef<string | null>(null)
  const wireFrom = useRef<string | null>(null)

  const nodes = useMemo(() => {
    if (!doc) return []
    const selected = new Set(selection)
    const live = new Set<string>()
    const out = toFlowNodes(doc, selected).map((n) => {
      // Stable data objects keep memoized nodes from re-rendering when another node moves.
      const cached = dataCache.get(n.id)
      const data =
        cached &&
        cached.refId === n.data.refId &&
        cached.refKind === n.data.refKind &&
        cached.locked === n.data.locked &&
        cached.labelColor === n.data.labelColor
          ? cached
          : n.data
      dataCache.set(n.id, data)
      live.add(n.id)
      return { ...n, data, draggable: canEdit && n.draggable, measured: measured[n.id] }
    })
    // Only nodes still on the view are kept.
    for (const id of dataCache.keys()) if (!live.has(id)) dataCache.delete(id)
    // Same zIndex: later is on top — cluster boxes above frames, both under devices and cables.
    const anns = toAnnotationNodes(doc, selected, canEdit)
    return [
      ...anns.filter((n) => n.type === 'frame'),
      ...toClusterNodes(clusterBoxes(doc, measured)),
      ...anns.filter((n) => n.type !== 'frame'),
      ...out,
    ] as Node[]
  }, [doc, selection, measured, canEdit, dataCache])
  const edgeSelection = useDoc((s) => s.edgeSelection)
  const edges = useMemo(
    () => (doc ? toFlowEdges(doc, new Set(edgeSelection)) : []),
    [doc, edgeSelection],
  )

  /** Frame drag: the devices inside it when the drag began move with it (Alt: the frame alone). */
  const frameDrag = useRef<{
    id: string
    x0: number
    y0: number
    carried: { id: string; x: number; y: number }[]
  } | null>(null)

  const annotationChange = (c: NodeChange) => {
    if (!('id' in c)) return
    const s = store.getState()
    const annId = c.id.slice(ANN.length)
    const a = s.doc?.view.annotations.find((x) => x.id === annId)
    if (!a) return
    const key = dragKey.current ?? undefined
    if (c.type === 'dimensions' && c.dimensions && c.resizing && a.kind === 'zone') {
      s.dispatch(
        updateAnnotation(
          annId,
          { width: Math.round(c.dimensions.width), height: Math.round(c.dimensions.height) },
          `resize:${annId}`,
        ),
      )
      return
    }
    if (c.type !== 'position' || !c.position) return
    const x = Math.round(c.position.x)
    const y = Math.round(c.position.y)
    if (a.kind === 'arrow') {
      // The node box is the arrow's bounding box: move both ends by the same delta.
      const o = arrowOrigin(a)
      const dx = x - o.x
      const dy = y - o.y
      const end = a.points?.[0] ?? { x: a.x + 120, y: a.y }
      s.dispatch(
        updateAnnotation(
          annId,
          { x: a.x + dx, y: a.y + dy, points: [{ x: end.x + dx, y: end.y + dy }] },
          key,
        ),
      )
      return
    }
    const f = frameDrag.current
    if (a.kind === 'zone' && f && f.id === annId) {
      const dx = x - f.x0
      const dy = y - f.y0
      s.dispatch(
        moveAnnotation(
          annId,
          x,
          y,
          f.carried.map((n) => ({ id: n.id, x: n.x + dx, y: n.y + dy })),
          key,
        ),
      )
      return
    }
    // Resizing from the top / left moves the frame's origin too.
    s.dispatch(
      updateAnnotation(
        annId,
        { x, y },
        c.type === 'position' && a.kind === 'zone' ? `resize:${annId}` : key,
      ),
    )
  }

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const { dispatch, setSelection, selection: current } = store.getState()
      const moves: { id: string; x: number; y: number }[] = []
      const picked = new Map<string, boolean>()
      const sizes: Record<string, { width: number; height: number }> = {}
      for (const c of changes) {
        if ('id' in c && isOverlayId(c.id)) {
          if (canEdit) annotationChange(c)
          if (c.type === 'select') picked.set(c.id, c.selected)
          continue
        }
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
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={(changes) => {
        const s = store.getState()
        const next = new Set(s.edgeSelection)
        let touched = false
        for (const c of changes)
          if (c.type === 'select') {
            touched = true
            if (c.selected) next.add(c.id)
            else next.delete(c.id)
          }
        if (touched) s.setEdgeSelection([...next])
      }}
      onNodeContextMenu={(e, node) => {
        e.preventDefault()
        // Right-clicking outside the selection selects that node, like file managers do.
        const s = store.getState()
        if (!s.selection.includes(node.id)) s.setSelection([node.id])
        // Acting on nodes must not touch cables picked earlier (and the other way round).
        s.setEdgeSelection([])
        onMenu({ kind: 'node', id: node.id }, e.clientX, e.clientY)
      }}
      onEdgeContextMenu={(e, edge) => {
        e.preventDefault()
        store.getState().setEdgeSelection([edge.id])
        store.getState().setSelection([])
        onMenu({ kind: 'edge', id: edge.id }, e.clientX, e.clientY)
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault()
        onMenu({ kind: 'pane' }, e.clientX, e.clientY)
      }}
      onNodeDragStart={(e, node) => {
        dragKey.current = `drag:${crypto.randomUUID()}`
        const s = store.getState()
        const a = isAnnotationId(node.id)
          ? s.doc?.view.annotations.find((x) => ANN + x.id === node.id)
          : undefined
        frameDrag.current =
          a?.kind === 'zone' && s.doc && !e.altKey
            ? {
                id: a.id,
                x0: a.x,
                y0: a.y,
                // Selected devices are moved by React Flow already.
                carried: nodesInFrame(s.doc, a, measured)
                  .filter((id) => !s.selection.includes(id))
                  .map((id) => {
                    const n = s.doc!.view.nodes.find((v) => v.id === id)!
                    return { id, x: n.x, y: n.y }
                  }),
              }
            : null
      }}
      onNodeDragStop={() => {
        dragKey.current = null
        frameDrag.current = null
      }}
      onMoveEnd={(_e, vp: Viewport) => {
        store.getState().setViewport(vp)
        try {
          localStorage.setItem(VIEWPORT_KEY(diagramId), JSON.stringify(vp))
        } catch {
          // storage full or blocked
        }
      }}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes(LIBRARY_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (!canEdit) return
        const item = decodeItem(e.dataTransfer.getData(LIBRARY_MIME))
        if (!item) return
        e.preventDefault()
        onDropItem(item, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      }}
      defaultViewport={initialViewport ?? undefined}
      fitView={!initialViewport}
      fitViewOptions={fitOptions(libraryOpen, prefs.panel)}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      snapToGrid={prefs.snap}
      snapGrid={[prefs.grid, prefs.grid]}
      nodesDraggable={canEdit}
      nodesConnectable={canEdit}
      connectionMode={ConnectionMode.Loose}
      className={wiring ? 'ntb-connecting' : undefined}
      onConnectStart={(_e, p) => {
        wireFrom.current = p.nodeId ?? null
      }}
      onConnectEnd={(e) => {
        // The cable ends on whatever node is under the pointer (not only on a connection point).
        const from = wireFrom.current
        wireFrom.current = null
        if (!from) return
        const pt = 'changedTouches' in e ? e.changedTouches[0] : e
        if (!pt) return
        const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest('.react-flow__node')
        const to = el?.getAttribute('data-id')
        if (to && to !== from && !isOverlayId(to)) onWire(from, to)
      }}
      onNodeClick={(_e, node) => {
        if (wiring && !isOverlayId(node.id)) onNodePick(node.id)
      }}
      onEdgeDoubleClick={(_e, edge) => onEditCable(edge.id)}
      elementsSelectable
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      panOnDrag={[1]}
      panOnScroll
      zoomOnPinch
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
