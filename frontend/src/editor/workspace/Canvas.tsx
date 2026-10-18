import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ConnectionMode,
  SelectionMode,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { edgeLabel } from '../overview/labels'
import { useSiteGraph } from '../overview/siteGraph'
import { moveAnnotation, moveNodes, updateAnnotation } from '../doc/commands'
import { decodeItem, LIBRARY_MIME, type LibraryItem } from '../library/items'
import { ConnectorContext, useDoc, useDocStoreApi, type ConnectorActions } from './context'
import { offPageConnectors, type Connector } from '../doc/offpage'
import { setNodeWidth, setStub } from '../doc/pageCommands'
import type { OffPageData } from './OffPageNode'
import { docOnPage, firstPageId, pagesOf } from '../doc/pages'
import {
  ANN,
  fitOptions,
  isAnnotationId,
  isOverlayId,
  litNodes,
  OFFPAGE,
  MAX_ZOOM,
  MIN_ZOOM,
  toAnnotationNodes,
  toClusterNodes,
  toFlowEdges,
  toFlowNodes,
  reuseUnchanged,
  type RefData,
} from './flow'
import { arrowOrigin, clusterBoxes, nodesInFrame, rectAround, siteFrameMembers } from './frames'
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
  // A diagram written with the default viewport (generated: overview, template, import) opens fitted instead.
  if (saved && saved.x === 0 && saved.y === 0 && saved.zoom === 1) return null
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
  hand,
  focusing = false,
  onNodeOpen,
  showOffPage = true,
  onConnectorOpen,
  onConnectorPlace,
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
  /** Hand tool on (toolbar / H). */
  hand: boolean
  /** Opened to show one object (?focus=): the page zooms to it, so no "fit the whole drawing" first. */
  focusing?: boolean
  /** Double click on a node: a site opens its detail diagram (P2-21). */
  onNodeOpen?: (nodeId: string) => void
  /** Off-page connectors (P2-08): shown (default), and what using one does. */
  showOffPage?: boolean
  onConnectorOpen?: (c: Connector) => void
  onConnectorPlace?: (c: Connector) => void
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const flow = useReactFlow()
  // What this page shows (P2-08): the same inventory, the view reduced to the page.
  const doc = useDoc((s) => (s.doc ? docOnPage(s.doc, s.page) : null))
  const selection = useDoc((s) => s.selection)
  // Each page remembers where this user looked (the canvas is remounted per page); the saved viewport is the first
  // page's.
  const [viewKey] = useState(() => {
    const s = store.getState()
    return s.doc && s.page !== firstPageId(s.doc.view) ? `${diagramId}:${s.page}` : diagramId
  })
  const [initialViewport] = useState(() =>
    startViewport(viewKey, viewKey === diagramId ? store.getState().viewport : null),
  )
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const measuredRef = useRef(measured)
  measuredRef.current = measured
  /** Site frames kept around their devices during a device drag: frame id → member node ids. */
  const fitPlan = useRef<Map<string, string[]> | null>(null)
  const [dataCache] = useState(() => new Map<string, RefData>())
  const [nodeCache] = useState(() => new Map<string, Node>())
  const [edgeCache] = useState(() => new Map<string, Edge>())
  const dragKey = useRef<string | null>(null)
  const spaceHeld = useSpaceHeld()
  const panning = hand || spaceHeld
  /** One undo step per resize gesture (NodeResizer reports `resizing: false` when it ends). */
  const resizeKey = useRef<{ id: string; key: string } | null>(null)
  const wireFrom = useRef<string | null>(null)

  // Off-page connectors need the whole diagram (where else each far end is drawn).
  const fullDoc = useDoc((s) => s.doc)
  const page = useDoc((s) => s.page)
  const layer = useDoc((s) =>
    s.doc
      ? (pagesOf(s.doc.view, s.meta?.layer ?? '').find((p) => p.id === s.page)?.layer ?? 'physical')
      : 'physical',
  )
  // An L3 page shows IP attachments, not cables: no off-page connectors there.
  const connectors = useMemo(
    () => (fullDoc && showOffPage && layer !== 'l3' ? offPageConnectors(fullDoc, page) : []),
    [fullDoc, page, showOffPage, layer],
  )
  const connectorActions = useMemo<ConnectorActions>(
    () => ({
      open: (c) => onConnectorOpen?.(c),
      place: (c) => onConnectorPlace?.(c),
      canEdit,
    }),
    [onConnectorOpen, onConnectorPlace, canEdit],
  )
  const lens = useDoc((s) => s.lens)
  const vlanFilter = useDoc((s) => s.vlanFilter)
  const edgeLens = useMemo(() => ({ lens, vlanFilter, layer }), [lens, vlanFilter, layer])
  // L2 view with a VLAN picked: nodes it does not touch fade.
  const lit = useMemo(() => (doc ? litNodes(doc, edgeLens) : null), [doc, edgeLens])

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
      // Hand tool / Space: nothing moves under the pointer, the view does.
      return {
        ...n,
        data,
        draggable: canEdit && !panning && n.draggable,
        measured: measured[n.id],
        ...(lit && !lit.has(n.id) && { className: 'ntb-l2-faded' }),
      }
    })
    // Only nodes still on the view are kept.
    for (const id of dataCache.keys()) if (!live.has(id)) dataCache.delete(id)
    // Same zIndex: later is on top — cluster boxes above frames, both under devices and cables.
    const anns = toAnnotationNodes(doc, selected, canEdit && !panning)
    return reuseUnchanged(nodeCache, [
      ...anns.filter((n) => n.type === 'frame'),
      ...toClusterNodes(clusterBoxes(doc, measured)),
      ...anns.filter((n) => n.type !== 'frame'),
      ...out,
      ...connectors.map((c): Node<OffPageData> => ({
        id: OFFPAGE + c.key,
        type: 'offpage',
        position: { x: c.x, y: c.y },
        data: { connector: c },
        draggable: canEdit && !panning,
        selectable: false,
        zIndex: 4,
      })),
    ] as Node[])
  }, [doc, selection, measured, canEdit, dataCache, nodeCache, panning, lit, connectors])
  const edgeSelection = useDoc((s) => s.edgeSelection)
  // Overview (P2-21): links between two sites drawn on the view, derived from the inventory, read-only.
  const { orgId = '' } = useParams()
  const hasSites = useDoc((s) => s.doc?.view.nodes.some((n) => n.refKind === 'site') ?? false)
  const siteGraph = useSiteGraph(orgId, hasSites)
  const siteEdges = useMemo(() => {
    if (!doc || !hasSites || !siteGraph.data) return []
    const nodeOf = new Map<string, string>()
    for (const n of doc.view.nodes) if (n.refKind === 'site') nodeOf.set(n.refId, n.id)
    // Shared networks (P2-08): the cloud on the overview joined to each drawn site cabled into it.
    const segOf = new Map<string, string>()
    for (const n of doc.view.nodes) if (n.refKind === 'segment') segOf.set(n.refId, n.id)
    const segEdges = siteGraph.data.segments.flatMap((g): Edge[] => {
      const seg = segOf.get(g.id)
      if (!seg) return []
      return g.sites.flatMap((x): Edge[] => {
        const site = nodeOf.get(x.siteId)
        return site
          ? [
              {
                id: `seg:${g.id}:${x.siteId}`,
                type: 'site',
                source: site,
                target: seg,
                selectable: false,
                deletable: false,
                focusable: false,
                data: {
                  label: x.links > 1 ? t('l2.cables', { count: x.links }) : '',
                  style: 'vpn',
                  links: [],
                },
              },
            ]
          : []
      })
    })
    return [
      ...segEdges,
      ...siteGraph.data.edges.flatMap((e): Edge[] => {
        const a = nodeOf.get(e.a)
        const b = nodeOf.get(e.b)
        return a && b
          ? [
              {
                id: `site:${e.a}:${e.b}`,
                type: 'site',
                source: a,
                target: b,
                selectable: false,
                deletable: false,
                focusable: false,
                data: { label: edgeLabel(e, t), style: e.style, links: e.links },
              },
            ]
          : []
      }),
    ]
  }, [doc, hasSites, siteGraph.data, t])
  const edges = useMemo(
    () =>
      doc
        ? reuseUnchanged(edgeCache, [
            ...(toFlowEdges(doc, new Set(edgeSelection), edgeLens) as Edge[]),
            ...siteEdges,
            ...connectors.map((c): Edge => {
              const l = c.links[0]!
              const here = doc.view.nodes.find((n) => n.id === c.nodeId)
              const port = here?.refId === l.aId ? l.aPort : l.bPort
              return {
                id: `oe:${c.key}`,
                source: c.nodeId,
                target: OFFPAGE + c.key,
                type: 'cable',
                className: `ntb-edge-${l.kind} ntb-edge-offpage`,
                selectable: false,
                focusable: false,
                deletable: false,
                data: {
                  linkId: l.id,
                  aPort: c.links.length === 1 ? port : '',
                  bPort: '',
                  status: l.status ?? 'up',
                  index: 0,
                  count: 1,
                },
              }
            }),
          ])
        : [],
    [doc, edgeSelection, edgeCache, siteEdges, edgeLens, connectors],
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
    if (c.type === 'dimensions' && a.kind === 'zone') {
      // `resizing: false` ends the gesture; a change without the flag is just React Flow measuring the node again
      // (it must not split one drag into many undo steps).
      if (!c.resizing) {
        if (c.resizing === false && resizeKey.current?.id === annId) resizeKey.current = null
        return
      }
      if (!c.dimensions) return
      if (resizeKey.current?.id !== annId)
        resizeKey.current = { id: annId, key: `resize:${annId}:${crypto.randomUUID()}` }
      s.dispatch(
        updateAnnotation(
          annId,
          { width: Math.round(c.dimensions.width), height: Math.round(c.dimensions.height) },
          resizeKey.current.key,
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
    // Resizing from the top / left moves the frame's origin too (same step as the resize).
    const resizing = resizeKey.current?.id === annId ? resizeKey.current.key : undefined
    s.dispatch(updateAnnotation(annId, { x, y }, resizing ?? key))
  }

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const { dispatch, setSelection, selection: current } = store.getState()
      const moves: { id: string; x: number; y: number }[] = []
      const picked = new Map<string, boolean>()
      const sizes: Record<string, { width: number; height: number }> = {}
      for (const c of changes) {
        // A moved off-page connector keeps its place (one undo step per drag).
        if ('id' in c && c.id.startsWith(OFFPAGE)) {
          if (c.type === 'position' && c.position && canEdit)
            dispatch(
              setStub(
                c.id.slice(OFFPAGE.length),
                store.getState().page,
                Math.round(c.position.x),
                Math.round(c.position.y),
                dragKey.current ?? undefined,
              ),
            )
          continue
        }
        if ('id' in c && isOverlayId(c.id)) {
          if (canEdit) annotationChange(c)
          if (c.type === 'select') picked.set(c.id, c.selected)
          continue
        }
        if (c.type === 'position' && c.position && canEdit)
          moves.push({ id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) })
        else if (c.type === 'select') picked.set(c.id, c.selected)
        else if (c.type === 'dimensions' && c.dimensions) {
          sizes[c.id] = c.dimensions
          // A subnet bar stretched by the user keeps its width (one undo step per gesture).
          if (
            c.resizing &&
            canEdit &&
            store.getState().doc?.view.nodes.find((n) => n.id === c.id)?.refKind === 'subnet'
          ) {
            if (resizeKey.current?.id !== c.id)
              resizeKey.current = { id: c.id, key: `resize:${c.id}:${crypto.randomUUID()}` }
            dispatch(setNodeWidth(c.id, Math.round(c.dimensions.width), resizeKey.current.key))
          } else if (c.resizing === false && resizeKey.current?.id === c.id)
            resizeKey.current = null
        }
      }
      if (moves.length > 0) {
        dispatch(moveNodes(moves, dragKey.current ?? undefined))
        // A site frame follows its devices (same undo step as the drag).
        const after = store.getState().doc
        if (fitPlan.current && after)
          for (const [frameId, members] of fitPlan.current) {
            const r = rectAround(after, members, measuredRef.current)
            if (r)
              dispatch(
                updateAnnotation(
                  frameId,
                  {
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    width: Math.round(r.w),
                    height: Math.round(r.h),
                  },
                  dragKey.current ?? undefined,
                ),
              )
          }
      }
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
    <ConnectorContext.Provider value={connectorActions}>
      <ReactFlow
        aria-label={t('editorCanvas.canvas')}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        elevateNodesOnSelect={false}
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
          if (edge.type === 'site') return
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
          const st = store.getState()
          // Geometry of this page only: frames hold the devices drawn on the same page.
          const s = { ...st, doc: st.doc ? docOnPage(st.doc, st.page) : null }
          // Dragging devices: the site frames holding any of them will wrap around their devices.
          fitPlan.current = null
          if (s.doc && !isOverlayId(node.id)) {
            const moved = new Set([node.id, ...s.selection])
            const plan = new Map(
              [...siteFrameMembers(s.doc, measured)].filter(([, members]) =>
                members.some((m) => moved.has(m)),
              ),
            )
            if (plan.size > 0) fitPlan.current = plan
          }
          const a = isAnnotationId(node.id)
            ? s.doc?.view.annotations.find((x) => ANN + x.id === node.id)
            : undefined
          frameDrag.current =
            a?.kind === 'zone' && s.doc && !e.altKey
              ? {
                  id: a.id,
                  x0: a.x,
                  y0: a.y,
                  // Every selected frame moves together (React Flow drags the selected frames); their devices follow the
                  // grabbed one's delta. Selected devices are moved by React Flow already.
                  carried: [
                    ...new Set(
                      s.doc.view.annotations
                        .filter(
                          (x) =>
                            x.kind === 'zone' &&
                            (x.id === a.id || s.selection.includes(ANN + x.id)),
                        )
                        .flatMap((x) => nodesInFrame(s.doc!, x, measured)),
                    ),
                  ]
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
          fitPlan.current = null
          frameDrag.current = null
        }}
        onMoveEnd={(_e, vp: Viewport) => {
          store.getState().setViewport(vp)
          try {
            localStorage.setItem(VIEWPORT_KEY(viewKey), JSON.stringify(vp))
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
        fitView={!initialViewport && !focusing}
        fitViewOptions={fitOptions(libraryOpen, prefs.panel && !prefs.panelMin)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        snapToGrid={prefs.snap}
        snapGrid={[prefs.grid, prefs.grid]}
        nodesDraggable={canEdit && !panning}
        nodesConnectable={canEdit}
        connectionMode={ConnectionMode.Loose}
        className={cn(wiring && 'ntb-connecting', panning && 'ntb-panning')}
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
        onEdgeDoubleClick={(_e, edge) => edge.type !== 'site' && onEditCable(edge.id)}
        onNodeDoubleClick={(_e, node) => !isOverlayId(node.id) && onNodeOpen?.(node.id)}
        elementsSelectable
        // Hand tool or Space held: the left button moves the view (also over devices); otherwise it draws a selection box
        // and the middle button pans.
        selectionOnDrag={!panning}
        selectionMode={SelectionMode.Partial}
        panOnDrag={panning ? true : [1]}
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
    </ConnectorContext.Provider>
  )
}

/**
 * Space held down outside text fields: the view pans with the left button. The key's default (scrolling the page,
 * pressing a focused toolbar button) is suppressed while it is held over the editor.
 */
function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
        t.closest('[role="dialog"]') !== null)
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return
      e.preventDefault()
      if (!e.repeat) setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setHeld(false)
    }
    const reset = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return held
}
