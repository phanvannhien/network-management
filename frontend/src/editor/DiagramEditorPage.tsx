import { ReactFlowProvider, useReactFlow, useStore as useFlowStore } from '@xyflow/react'
import {
  Cable,
  ClipboardPaste,
  Pencil,
  Copy,
  CopyPlus,
  ExternalLink,
  Lock,
  LockOpen,
  LibraryBig,
  PanelRight,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { atLeast } from '@/modules/sites/access'
import {
  ConflictError,
  fetchDiagram,
  useDiagram,
  useDiagramMutations,
  useDiagrams,
} from './doc/api'
import { createDevice, createGroup, newId } from './doc/commands'
import { expandTemplatePorts } from './library/ports'
import { useTemplateChoices } from '@/modules/inventory/TemplatePicker'
import { draftStore, type Draft } from './doc/drafts'
import { createDocStore, type DocStoreApi } from './doc/store'
import { changesOf } from './doc/types'
import type { DeviceType, LibraryItem } from './library/items'
import { LibraryPanel } from './library/LibraryPanel'
import { defaultSiteFor } from './library/placement'
import { isAnnotationId } from './workspace/flow'
import { frameAt } from './workspace/frames'
import { useAnnotate } from './workspace/useAnnotate'
import { NewDeviceDialog, type NewDeviceInput } from './library/NewDeviceDialog'
import { NewEndpointDialog, type NewEndpointInput } from './library/NewEndpointDialog'
import type { EndpointKind } from './library/items'
import { QuickAdd } from './library/QuickAdd'
import { Canvas } from './workspace/Canvas'
import { DeleteFromInventoryDialog } from './workspace/DeleteFromInventoryDialog'
import { NodeMenu, type MenuItem } from './workspace/NodeMenu'
import { useEditActions } from './workspace/useEditActions'
import { CableDialog } from './workspace/CableDialog'
import { PropertiesPanel } from './workspace/PropertiesPanel'
import { useWiring } from './workspace/useWiring'
import { PanelRail } from './workspace/PanelRail'
import { ExportImageDialog } from './workspace/ExportImageDialog'
import { FrameDrawLayer } from './workspace/FrameDrawLayer'
import { ProblemsPanel } from './checks/ProblemsPanel'
import { SiteDrillDialog } from './overview/SiteDrillDialog'
import { useSiteGraph, type SiteCard } from './overview/siteGraph'
import { countProblems } from './checks/types'
import { useChecks } from './checks/useChecks'
import { fitOptions } from './workspace/flow'
import { DocStoreContext } from './workspace/context'
import { togglePanel, useEditorPrefs } from './workspace/prefs'
import { VlanLegend } from './l2/VlanLegend'
import { ANN } from './doc/types'
import { docOnPage, firstPageId, pageLabel, pageOf, pagesOf, type PageLayer } from './doc/pages'
import {
  addPage,
  duplicatePage,
  movePage,
  removePage,
  renamePage,
  sendToPage,
  setPageLayer,
} from './doc/pageCommands'
import { PageTabs } from './workspace/PageTabs'
import { actionFor, CANVAS_ONLY, isTyping, keysLabel } from './workspace/shortcuts'
import { ShortcutsDialog } from './workspace/ShortcutsDialog'
import { Tips } from './workspace/Tips'
import { Toolbar } from './workspace/Toolbar'

const DRAFT_DELAY_MS = 600

/**
 * Diagram editor (P1-13, P1-14): loads a diagram into the document store, keeps unsent work as an IndexedDB draft,
 * saves view + inventory changes in one request, and shows conflicts. The canvas fills the page under a floating
 * toolbar; the app's side menu folds while drawing (AppShell).
 */
export function DiagramEditorPage() {
  const { t } = useTranslation()
  const { orgId = '', diagramId = '' } = useParams()
  const detail = useDiagram(orgId, diagramId)
  const [store] = useState(createDocStore)
  const meta = useStore(store, (s) => s.meta)
  const doc = useStore(store, (s) => s.doc)
  const status = useStore(store, (s) => s.status)
  const loadId = useStore(store, (s) => s.loadId)
  const { save } = useDiagramMutations(orgId)
  const [offer, setOffer] = useState<Draft | null>(null)
  const loadedFor = useRef<string | null>(null)
  // Opened from an overview (P2-21): the overview stays in the breadcrumb to go back up.
  const [search] = useSearchParams()
  const from = search.get('from') ?? ''
  // The name from the diagram list (a full view of the overview would stay cached and go stale).
  const list = useDiagrams(orgId)
  const parent = from && from !== diagramId ? list.data?.find((d) => d.id === from) : undefined
  useBreadcrumbs([
    { label: t('nav.diagrams'), to: `/o/${orgId}/diagrams` },
    ...(parent ? [{ label: parent.name, to: `/o/${orgId}/diagrams/${from}` }] : []),
    { label: meta?.name ?? '…' },
  ])

  // Load once per diagram, then offer a draft left from an earlier session.
  useEffect(() => {
    if (!detail.data || loadedFor.current === diagramId) return
    loadedFor.current = diagramId
    store.getState().load(detail.data)
    void draftStore()
      .get(diagramId)
      .then((d) => d && setOffer(d))
  }, [detail.data, diagramId, store])

  // Unsent work goes to IndexedDB shortly after each change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: Draft | null = null
    const unsub = store.subscribe((s, prev) => {
      // Saved: a draft still waiting to be written is obsolete (leaving right after Ctrl+S must not write it and
      // offer it back on return).
      if (s.status === 'clean' && prev.status !== 'clean') {
        clearTimeout(timer)
        pending = null
        return
      }
      if (s.doc === prev.doc || s.status === 'clean' || !s.doc || !s.meta) return
      clearTimeout(timer)
      const draft: Draft = {
        diagramId,
        baseVersion: s.meta.version,
        doc: s.doc,
        savedAt: new Date().toISOString(),
      }
      pending = draft
      timer = setTimeout(() => {
        pending = null
        void draftStore().put(draft)
      }, DRAFT_DELAY_MS)
    })
    return () => {
      // Leaving the editor right after a change (Back, a menu link) must not lose it: write the draft now.
      clearTimeout(timer)
      if (pending) void draftStore().put(pending)
      unsub()
    }
  }, [store, diagramId])

  const dirty = status === 'dirty' || status === 'conflict' || status === 'error'
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canEdit = atLeast(meta?.access, 'edit')
  const doSave = () => {
    // One save at a time: a second one would send the same version and get a conflict.
    if (store.getState().status === 'saving') return
    const body = store.getState().saveRequest()
    if (!body || !canEdit) return
    store.getState().setStatus('saving')
    save.mutate(
      { diagramId, body },
      {
        onSuccess: (r) => {
          store.getState().saved(r.detail)
          void draftStore().remove(diagramId)
          toast.success(t('editorDoc.saved'))
        },
        onError: (e) =>
          store.getState().setStatus(e instanceof ConflictError ? 'conflict' : 'error', e.message),
      },
    )
  }
  const saveRef = useRef(doSave)
  useEffect(() => {
    saveRef.current = doSave
  })
  const reload = async () => {
    const fresh = await fetchDiagram(orgId, diagramId)
    store.getState().load(fresh)
    await draftStore().remove(diagramId)
    setOffer(null)
  }

  if (detail.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!detail.data) return <NotFoundPage inShell />
  if (!doc || !meta) return null
  return (
    <DocStoreContext.Provider value={store}>
      <ReactFlowProvider>
        <div className="relative h-full min-h-96 overflow-hidden">
          <Workspace
            key={loadId}
            orgId={orgId}
            diagramId={diagramId}
            store={store}
            canEdit={canEdit}
            onSave={() => saveRef.current()}
          />
          <div className="absolute top-16 right-3 z-20 w-96 max-w-[calc(100%-1.5rem)] space-y-2">
            {offer && (
              <Alert className="shadow-md">
                <AlertTitle>
                  {t('editorDoc.draftTitle', { time: formatDateTime(offer.savedAt) })}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {offer.baseVersion === meta.version
                      ? t('editorDoc.draftBody')
                      : t('editorDoc.draftStale')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        store.getState().restore(offer.doc)
                        setOffer(null)
                      }}
                    >
                      {t('editorDoc.restore')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void draftStore().remove(diagramId)
                        setOffer(null)
                      }}
                    >
                      {t('editorDoc.discard')}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {(status === 'conflict' || status === 'error') && (
              <Alert variant="destructive" className="shadow-md">
                <AlertTitle>
                  {status === 'conflict' ? t('editorDoc.conflictTitle') : t('editorDoc.errorTitle')}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{store.getState().error}</p>
                  {status === 'conflict' && (
                    <Button size="sm" variant="outline" onClick={() => void reload()}>
                      {t('editorDoc.reload')}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </ReactFlowProvider>
    </DocStoreContext.Provider>
  )
}

const ZOOM_MS = 150

/** Size of a device node on the canvas, to place it centred on a point. */
const NODE_W = 144
const NODE_H = 80

interface PendingNew {
  type: DeviceType
  templateId: string | null
  at: { x: number; y: number }
}

/** Canvas, toolbar, library, keys and hints; lives inside the React Flow provider so it can drive the viewport. */
function Workspace({
  orgId,
  diagramId,
  store,
  canEdit,
  onSave,
}: {
  orgId: string
  diagramId: string
  store: DocStoreApi
  canEdit: boolean
  onSave: () => void
}) {
  const { t } = useTranslation()
  const flow = useReactFlow()
  const meta = useStore(store, (s) => s.meta)!
  const doc = useStore(store, (s) => s.doc)!
  const status = useStore(store, (s) => s.status)
  const canUndo = useStore(store, (s) => s.past.length > 0)
  const canRedo = useStore(store, (s) => s.future.length > 0)
  const lens = useStore(store, (s) => s.lens)
  // Pages (P2-08): the canvas, the library and the edit actions work on the page being edited.
  const page = useStore(store, (s) => s.page)
  const pageDoc = useMemo(() => docOnPage(doc, page), [doc, page])
  const pages = useMemo(() => pagesOf(doc.view, meta.layer), [doc.view, meta.layer])
  const width = useFlowStore((s) => s.width)
  const height = useFlowStore((s) => s.height)
  const [prefs, setPrefs] = useEditorPrefs()
  const [help, setHelp] = useState(false)
  const [quick, setQuick] = useState(false)
  const [creating, setCreating] = useState<PendingNew | null>(null)
  const [creatingEndpoint, setCreatingEndpoint] = useState<{
    kind: EndpointKind
    at: { x: number; y: number }
  } | null>(null)
  const [lastSite, setLastSite] = useState<string | null>(null)
  const onView = useMemo(
    () => new Set(pageDoc.view.nodes.map((n) => n.refId)),
    [pageDoc.view.nodes],
  )
  const hostnames = useMemo(
    () => new Set(Object.values(doc.devices).map((d) => d.hostname)),
    [doc.devices],
  )
  // "Open" = taking room on the canvas; a folded panel is a slim rail at the edge.
  const libraryOpen = canEdit && prefs.library && !prefs.libraryMin
  const panelOpen = prefs.panel && !prefs.panelMin
  const choices = useTemplateChoices(orgId, canEdit)
  const edit = useEditActions({ orgId, store, canEdit, grid: prefs.grid })
  const annotate = useAnnotate({
    store,
    canEdit,
    centre: () => centre(),
    sizes: () =>
      Object.fromEntries(
        flow
          .getNodes()
          .filter((n) => n.measured?.width)
          .map((n) => [n.id, { width: n.measured!.width!, height: n.measured!.height! }]),
      ),
  })
  const wiring = useWiring({ orgId, store, canEdit })
  const checks = useChecks(orgId, store)
  const problems = useStore(store, (s) => s.problems)
  const problemCounts = useMemo(() => countProblems(problems), [problems])
  const [problemsOpen, setProblemsOpen] = useState(false)
  /** Hand tool: the left button pans the view (Space + drag does it any time). */
  const [hand, setHand] = useState(false)
  /** Frame tool: the next drag on the canvas draws a frame. */
  const [drawingFrame, setDrawingFrame] = useState(false)
  const [exporting, setExporting] = useState(false)
  const startFrameTool = () => {
    setHand(false)
    setDrawingFrame(true)
  }
  const [menu, setMenu] = useState<{
    x: number
    y: number
    kind: 'node' | 'edge' | 'pane'
    id?: string
  } | null>(null)

  const fit = () => void flow.fitView({ ...fitOptions(libraryOpen, panelOpen), duration: ZOOM_MS })
  // ?focus=<object id> (global search, P1-23): select the object's node and bring it into view once the nodes are
  // measured, then drop the parameter so a reload does not jump again.
  const [params, setParams] = useSearchParams()
  const focusRef = params.get('focus')
  const [openedFocused] = useState(() => focusRef !== null)
  // useNodesInitialized stays false with frames and notes (no handles): wait for any measured node instead — and for
  // the zoom controller, or fitView is silently dropped (a diagram opening at a saved viewport).
  const pageNodeIds = useMemo(() => new Set(pageDoc.view.nodes.map((n) => n.id)), [pageDoc])
  const nodesReady = useFlowStore(
    (st) =>
      st.panZoom !== null &&
      st.nodes.some((n) => n.measured?.width && (pageNodeIds.size === 0 || pageNodeIds.has(n.id))),
  )
  useEffect(() => {
    // Still showing the previous diagram (moving from an overview to a detail diagram): wait for the new one.
    if (!focusRef || !nodesReady || meta.id !== diagramId) return
    // The object may be on another page: open that page first (this runs again once it is drawn).
    const anywhere =
      doc.view.nodes.find((n) => n.refId === focusRef) ??
      doc.view.nodes.find((n) => doc.devices[n.refId]?.clusterId === focusRef) ??
      doc.view.annotations.find((a) => a.kind === 'zone' && a.siteId === focusRef)
    if (anywhere && pageOf(doc.view, anywhere) !== page) {
      store.getState().setPage(pageOf(doc.view, anywhere))
      return
    }
    const doc_ = pageDoc
    // A cluster is drawn through its members: its first member on the diagram.
    const node =
      doc_.view.nodes.find((n) => n.refId === focusRef) ??
      doc_.view.nodes.find((n) => doc.devices[n.refId]?.clusterId === focusRef)
    // A site (drilling down from an overview, P2-21): its frame, zoomed to fill the view.
    const frame = node
      ? undefined
      : doc_.view.annotations.find((a) => a.kind === 'zone' && a.siteId === focusRef)
    if (frame) {
      // Fit the frame in what the side panels leave visible, centred there.
      const left = libraryOpen ? 312 : 32
      const right = panelOpen ? 352 : 32
      const w = frame.width ?? 640
      const h = frame.height ?? 400
      const zoom = Math.max(0.2, Math.min(1.2, (width - left - right) / w, (height - 104) / h))
      const dx = (left - right) / 2 / zoom
      void flow.setCenter(frame.x + w / 2 - dx, frame.y + h / 2 - 20 / zoom, {
        zoom,
        duration: ZOOM_MS,
      })
    }
    // Neither a node nor a frame: the site's devices on the diagram, else the whole drawing.
    if (!node && !frame) {
      const here = doc_.view.nodes.filter((n) => doc.devices[n.refId]?.siteId === focusRef)
      if (here.length > 0)
        void flow.fitView({
          ...fitOptions(libraryOpen, panelOpen),
          nodes: here.map((n) => ({ id: n.id })),
        })
      else fit()
    }
    if (node) {
      const s = store.getState()
      s.setEdgeSelection([])
      s.setSelection([node.id])
      // Opened with ?focus= the canvas skips its own "fit the whole drawing", which would otherwise win.
      // Centre on it at 1.2× (fitView with nodes right after load can resolve without moving the view).
      const n = flow.getInternalNode(node.id)
      if (n) {
        const w = n.measured.width ?? NODE_W
        const h = n.measured.height ?? NODE_H
        void flow.setCenter(
          n.internals.positionAbsolute.x + w / 2,
          n.internals.positionAbsolute.y + h / 2,
          {
            zoom: 1.2,
            duration: ZOOM_MS,
          },
        )
      }
    }
    setParams(
      (p) => {
        p.delete('focus')
        return p
      },
      { replace: true },
    )
  }, [focusRef, nodesReady, meta.id, page]) // eslint-disable-line react-hooks/exhaustive-deps
  // Double click (P2-21): a site opens its detail diagram (one: straight away; several or none: a dialog); a diagram
  // node opens that diagram. The overview stays in the URL for the breadcrumb.
  const siteGraph = useSiteGraph(
    orgId,
    doc.view.nodes.some((n) => n.refKind === 'site'),
  )
  const navigate = useNavigate()
  const [drill, setDrill] = useState<SiteCard | null>(null)
  const openNode = (nodeId: string) => {
    const n = doc.view.nodes.find((x) => x.id === nodeId)
    if (!n) return
    if (n.refKind === 'diagram') void navigate(`/o/${orgId}/diagrams/${n.refId}?from=${diagramId}`)
    if (n.refKind !== 'site') return
    const card = siteGraph.data?.sites.find((x) => x.id === n.refId)
    if (!card) return
    if (card.diagrams.length === 1)
      void navigate(
        `/o/${orgId}/diagrams/${card.diagrams[0]!.id}?from=${diagramId}&focus=${card.id}`,
      )
    else setDrill(card)
  }
  /** Top-left for a node centred on `at`, on the grid when snapping. */
  const place = (at: { x: number; y: number }) => {
    const step = prefs.snap ? prefs.grid : 1
    const snap = (v: number) => Math.round(v / step) * step
    return { x: snap(at.x - NODE_W / 2), y: snap(at.y - NODE_H / 2) }
  }
  /** Middle of the view, nudged so repeated adds do not stack exactly. */
  const centre = () => {
    const vp = flow.getViewport()
    const nudge = (doc.view.nodes.length % 5) * 2 * prefs.grid
    return {
      x: (width / 2 - vp.x) / vp.zoom + nudge,
      y: (height / 2 - vp.y) / vp.zoom + nudge,
    }
  }
  const pick = (item: LibraryItem, at = centre()) => {
    if (!canEdit) return
    if (item.kind === 'device') {
      const { x, y } = place(at)
      void edit.placeDevice(item.device, x, y)
      return
    }
    if (item.kind === 'endpoint') {
      setCreatingEndpoint({ kind: item.endpointKind, at })
      return
    }
    setCreating({
      type: item.type,
      templateId: item.kind === 'template' ? item.templateId : null,
      at,
    })
  }
  /** Endpoints (ADR-036): a pending endpoint group drawn where it was dropped, created on save. */
  const createEndpoint = (input: NewEndpointInput) => {
    if (!creatingEndpoint) return
    const { x, y } = place(creatingEndpoint.at)
    store.getState().dispatch(
      createGroup(
        {
          kind: input.kind,
          name: input.name,
          siteId: input.siteId,
          expectedCount: input.expectedCount,
        },
        x,
        y,
      ),
    )
    setLastSite(input.siteId)
    setCreatingEndpoint(null)
  }
  const create = (input: NewDeviceInput) => {
    if (!creating) return
    const frame = frameAt(doc, creating.at.x, creating.at.y)
    const { x, y } = place(creating.at)
    // The template's ports exist right away (temp ids), so the new device can be cabled before saving (P1-17).
    const tpl = choices.resolve(input.templateId)
    const groups = tpl?.ports
    store.getState().dispatch(
      createDevice(
        {
          hostname: input.hostname,
          type: input.type,
          siteId: input.siteId,
          templateId: tpl?.kind === 'org' ? tpl.id : null,
          ...(tpl?.kind === 'sys' ? { catalogId: tpl.id } : {}),
          ...(input.model ? { model: input.model } : {}),
          // Dropped inside a location frame of the same site: the device is in that location (ADR-032).
          ...(frame?.locationId && frame.siteId === input.siteId
            ? { locationId: frame.locationId }
            : {}),
        },
        x,
        y,
        newId(),
        newId(),
        groups ? expandTemplatePorts(groups) : [],
      ),
    )
    setLastSite(input.siteId)
    setCreating(null)
  }

  const root = useRef<HTMLDivElement>(null)
  const run = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    run.current = (e: KeyboardEvent) => {
      const action = actionFor(e)
      if (!action) return
      const target = e.target instanceof Element ? e.target : null
      // Save works from anywhere; the rest only from the editor (not the app menu, a field or a dialog), and
      // Delete / select all only when the canvas itself has the focus.
      if (action !== 'save') {
        if (isTyping(target)) return
        const inEditor = !target || target === document.body || root.current?.contains(target)
        if (!inEditor) return
        const onCanvas =
          !target || target === document.body || target.closest('.react-flow') !== null
        if (CANVAS_ONLY.has(action) && !onCanvas) return
      }
      const s = store.getState()
      switch (action) {
        case 'save':
          onSave()
          break
        case 'undo':
          s.undo()
          break
        case 'redo':
          s.redo()
          break
        case 'fit':
          fit()
          break
        case 'zoomIn':
          void flow.zoomIn({ duration: ZOOM_MS })
          break
        case 'zoomOut':
          void flow.zoomOut({ duration: ZOOM_MS })
          break
        case 'zoomReset':
          void flow.zoomTo(1, { duration: ZOOM_MS })
          break
        case 'selectAll':
          s.setSelection(pageDoc.view.nodes.map((n) => n.id))
          break
        case 'deselect':
          s.setSelection([])
          s.setEdgeSelection([])
          setMenu(null)
          wiring.cancel()
          setDrawingFrame(false)
          break
        case 'connect':
          if (!canEdit) return
          setHand(false)
          wiring.toggle()
          break
        case 'pagePrev':
        case 'pageNext': {
          const i = pages.findIndex((x) => x.id === s.page)
          const next = pages[i + (action === 'pageNext' ? 1 : -1)]
          if (next) s.setPage(next.id)
          break
        }
        case 'lensPhysical':
        case 'lensL2':
          // The overview diagram has sites, not cables with VLANs.
          if (s.meta?.layer !== 'overview') s.setLens(action === 'lensL2' ? 'l2' : 'physical')
          break
        case 'hand':
          wiring.cancel()
          setDrawingFrame(false)
          setHand((h) => !h)
          break
        case 'pointer':
          wiring.cancel()
          setHand(false)
          setDrawingFrame(false)
          break
        case 'remove':
          edit.remove()
          break
        case 'deleteInventory':
          edit.requestDelete()
          break
        case 'copy':
          edit.copy()
          break
        case 'paste':
          edit.paste()
          break
        case 'duplicate':
          edit.duplicate()
          break
        case 'lock':
          edit.toggleLock()
          break
        case 'group':
          // With devices selected: a frame around them. Otherwise: the frame tool (drag to draw).
          if (store.getState().selection.length > 0) annotate.frame()
          else if (canEdit) startFrameTool()
          break
        case 'ungroup':
          annotate.ungroup()
          break
        case 'quickAdd':
          if (!canEdit) return
          setQuick(true)
          break
        case 'library':
          if (!canEdit) return
          setPrefs(togglePanel(prefs, 'library'))
          break
        case 'help':
          setHelp(true)
          break
        default:
          return
      }
      e.preventDefault()
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => run.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Selected nodes and frames to another page (moved, or also placed there). */
  const sendSelection = (pageId: string, copy: boolean) => {
    const s = store.getState()
    const nodeIds = s.selection.filter((id) => !isAnnotationId(id))
    const annIds = s.selection.filter(isAnnotationId).map((id) => id.slice(ANN.length))
    if (nodeIds.length + annIds.length === 0) return
    s.dispatch(sendToPage(nodeIds, annIds, pageId, copy))
    const target = pages.find((x) => x.id === pageId)
    if (!copy && target)
      toast.success(
        t('pages.moved', {
          count: nodeIds.length + annIds.length,
          name: pageLabel(target, pages.indexOf(target), t),
        }),
      )
  }
  // Page tabs: commands (undoable); the implicit single page gets a real name when a second page comes.
  const firstName = pageLabel(pages[0]!, 0, t)
  const firstLayer = pages[0]!.layer
  const pageActions = {
    add: () => {
      const id = newId()
      store
        .getState()
        .dispatch(
          addPage(
            id,
            t('pages.untitled', { n: pages.length + 1 }),
            'physical',
            firstName,
            firstLayer,
          ),
        )
      store.getState().setPage(id)
    },
    rename: (id: string, name: string) =>
      store.getState().dispatch(renamePage(id, name, firstLayer)),
    duplicate: (id: string) => {
      const src = pages.find((x) => x.id === id)
      if (!src) return
      const copyId = newId()
      const name = t('pages.copyName', { name: pageLabel(src, pages.indexOf(src), t) }).slice(0, 80)
      store.getState().dispatch(duplicatePage(id, copyId, name, firstName))
      store.getState().setPage(copyId)
    },
    layer: (id: string, layer: PageLayer) => {
      store.getState().dispatch(setPageLayer(id, layer, firstName))
      if (id === store.getState().page) store.getState().setLens(layer === 'l2' ? 'l2' : 'physical')
    },
    move: (id: string, delta: -1 | 1) => store.getState().dispatch(movePage(id, delta)),
    remove: (id: string) => store.getState().dispatch(removePage(id)),
  }
  const pageCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const n of doc.view.nodes) out[pageOf(doc.view, n)] = (out[pageOf(doc.view, n)] ?? 0) + 1
    for (const a of doc.view.annotations)
      out[pageOf(doc.view, a)] = (out[pageOf(doc.view, a)] ?? 0) + 1
    return out
  }, [doc.view])
  // ?page= follows the tab (a link opens the same page); undo on another page says where it went.
  useEffect(() => {
    if (meta.id !== diagramId) return
    const wanted = params.get('page')
    if (wanted && wanted !== store.getState().page) store.getState().setPage(wanted)
  }, [meta.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (meta.id !== diagramId) return
    setParams(
      (p) => {
        if (page === firstPageId(doc.view)) p.delete('page')
        else p.set('page', page)
        return p
      },
      { replace: true },
    )
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  const pageJump = useStore(store, (s) => s.pageJump)
  useEffect(() => {
    if (!pageJump) return
    const target = pages.find((x) => x.id === pageJump.pageId)
    if (target) toast.info(t('pages.jumped', { name: pageLabel(target, pages.indexOf(target), t) }))
  }, [pageJump]) // eslint-disable-line react-hooks/exhaustive-deps

  const menuItems = (m: { kind: 'node' | 'edge' | 'pane'; id?: string }): MenuItem[] => {
    const keys = (id: Parameters<typeof keysLabel>[0]) => keysLabel(id)
    if (m.kind === 'pane')
      return [
        {
          id: 'paste',
          label: t('editorCanvas.keys.paste'),
          icon: <ClipboardPaste aria-hidden />,
          keys: keys('paste'),
          disabled: !canEdit || !edit.hasClip(),
          onSelect: edit.paste,
        },
        {
          id: 'all',
          label: t('editorCanvas.keys.selectAll'),
          keys: keys('selectAll'),
          onSelect: () => store.getState().setSelection(pageDoc.view.nodes.map((n) => n.id)),
        },
      ]
    if (m.kind === 'edge')
      return [
        {
          id: 'edit',
          label: t('cable.editTitle'),
          icon: <Pencil aria-hidden />,
          disabled: !canEdit,
          onSelect: () => m.id && wiring.editCable(m.id),
        },
        {
          id: 'delete',
          label: t('editorEdit.deleteCable'),
          icon: <Trash2 aria-hidden />,
          keys: keys('remove'),
          danger: true,
          disabled: !canEdit,
          onSelect: edit.requestDelete,
        },
      ]
    if (m.id && isAnnotationId(m.id))
      return [
        {
          id: 'delete',
          label: t('frames.delete'),
          icon: <Trash2 aria-hidden />,
          keys: keys('remove'),
          disabled: !canEdit,
          onSelect: () => {
            store.getState().setSelection([m.id!])
            edit.remove()
          },
        },
      ]
    const node = doc.view.nodes.find((n) => n.id === m.id)
    const card = node?.refKind === 'device' ? doc.devices[node.refId] : undefined
    const locked = store
      .getState()
      .selection.every((id) => doc.view.nodes.find((n) => n.id === id)?.locked)
    return [
      {
        id: 'copy',
        label: t('editorCanvas.keys.copy'),
        icon: <Copy aria-hidden />,
        keys: keys('copy'),
        onSelect: edit.copy,
      },
      {
        id: 'duplicate',
        label: t('editorCanvas.keys.duplicate'),
        icon: <CopyPlus aria-hidden />,
        keys: keys('duplicate'),
        disabled: !canEdit,
        onSelect: edit.duplicate,
      },
      {
        id: 'lock',
        label: locked ? t('editorEdit.unlock') : t('editorEdit.lock'),
        icon: locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />,
        keys: keys('lock'),
        disabled: !canEdit,
        onSelect: edit.toggleLock,
      },
      {
        id: 'connect',
        label: t('cable.fromHere'),
        icon: <Cable aria-hidden />,
        keys: keys('connect'),
        disabled: !canEdit,
        onSelect: () => m.id && wiring.toggle(m.id),
      },
      // Another page (P2-08): move what is selected there, or also place a device there as a landmark.
      ...pages
        .filter((x) => x.id !== page)
        .slice(0, 8)
        .flatMap((x, i): MenuItem[] => {
          const name = pageLabel(x, pages.indexOf(x), t)
          return [
            {
              id: `move-${x.id}`,
              label: `${t('pages.moveTo')}: ${name}`,
              disabled: !canEdit,
              separated: i === 0,
              onSelect: () => sendSelection(x.id, false),
            },
            ...(node?.refKind === 'device'
              ? [
                  {
                    id: `copy-${x.id}`,
                    label: `${t('pages.copyTo')}: ${name}`,
                    disabled: !canEdit,
                    onSelect: () => sendSelection(x.id, true),
                  },
                ]
              : []),
          ]
        }),
      {
        id: 'open',
        label: t('editorEdit.openDevice'),
        icon: <ExternalLink aria-hidden />,
        disabled: !card || card.draft === true,
        separated: true,
        onSelect: () => card && window.open(`/o/${orgId}/devices/${card.id}`, '_blank', 'noopener'),
      },
      {
        id: 'remove',
        label: t('editorDoc.removeFromDiagram'),
        icon: <X aria-hidden />,
        keys: keys('remove'),
        disabled: !canEdit,
        separated: true,
        onSelect: edit.remove,
      },
      {
        id: 'delete',
        label: t('editorEdit.deleteFromInventory'),
        icon: <Trash2 aria-hidden />,
        keys: keys('deleteInventory'),
        danger: true,
        disabled: !canEdit || node?.refKind !== 'device',
        onSelect: edit.requestDelete,
      },
    ]
  }

  return (
    <div ref={root} className="contents">
      <Canvas
        key={page}
        focusing={openedFocused}
        onNodeOpen={openNode}
        diagramId={diagramId}
        canEdit={canEdit}
        prefs={prefs}
        libraryOpen={libraryOpen}
        onDropItem={pick}
        onWire={wiring.wire}
        wiring={wiring.mode !== null}
        onNodePick={wiring.pick}
        onEditCable={wiring.editCable}
        hand={hand}
        onMenu={(target, x, y) => {
          const box = root.current?.parentElement?.getBoundingClientRect()
          setMenu({ ...target, x: x - (box?.left ?? 0), y: y - (box?.top ?? 0) })
        }}
      />
      <Toolbar
        orgId={orgId}
        name={meta.name}
        layer={t(`diagrams.layers.${meta.layer}`)}
        lens={meta.layer === 'overview' ? undefined : lens}
        onLens={(l) => store.getState().setLens(l)}
        status={status}
        pending={changesOf(doc).length}
        canEdit={canEdit}
        canUndo={canUndo}
        canRedo={canRedo}
        prefs={prefs}
        onPrefs={setPrefs}
        onUndo={() => store.getState().undo()}
        onRedo={() => store.getState().redo()}
        onSave={onSave}
        onZoomIn={() => void flow.zoomIn({ duration: ZOOM_MS })}
        onZoomOut={() => void flow.zoomOut({ duration: ZOOM_MS })}
        onZoomReset={() => void flow.zoomTo(1, { duration: ZOOM_MS })}
        onFit={fit}
        onHelp={() => setHelp(true)}
        onExport={() => setExporting(true)}
        onQuickAdd={() => setQuick(true)}
        onAddFrame={() => (drawingFrame ? setDrawingFrame(false) : startFrameTool())}
        drawingFrame={drawingFrame}
        onAddText={annotate.text}
        onAddArrow={annotate.arrow}
        connecting={wiring.mode !== null}
        onConnect={() => {
          setHand(false)
          setDrawingFrame(false)
          wiring.toggle()
        }}
        hand={hand}
        onHand={() => {
          wiring.cancel()
          setDrawingFrame(false)
          setHand((h) => !h)
        }}
        onPointer={() => {
          wiring.cancel()
          setHand(false)
          setDrawingFrame(false)
        }}
        problems={problemCounts}
        problemsOpen={problemsOpen}
        onProblems={() => setProblemsOpen((o) => !o)}
      />
      {problemsOpen && (
        <ProblemsPanel
          loading={checks.loading}
          error={checks.error}
          fitPadding={fitOptions(libraryOpen, panelOpen)}
          onClose={() => setProblemsOpen(false)}
        />
      )}
      {drawingFrame && (
        <>
          <FrameDrawLayer
            onDone={(r) => {
              annotate.frameAt(r)
              setDrawingFrame(false)
            }}
          />
          <div
            role="status"
            className="absolute top-16 left-1/2 z-10 -translate-x-1/2 rounded-md border border-primary bg-popover px-3 py-1.5 shadow-md"
          >
            {t('frames.drawHint')}{' '}
            <span className="text-muted-foreground">{t('cable.escToCancel')}</span>
          </div>
        </>
      )}
      {wiring.mode && (
        <div
          role="status"
          className="absolute top-16 left-1/2 z-10 -translate-x-1/2 rounded-md border border-primary bg-popover px-3 py-1.5 shadow-md"
        >
          {wiring.mode.from ? t('cable.pickSecond') : t('cable.pickFirst')}{' '}
          <span className="text-muted-foreground">{t('cable.escToCancel')}</span>
        </div>
      )}
      {libraryOpen && (
        <LibraryPanel
          orgId={orgId}
          onView={onView}
          onPick={(item) => pick(item)}
          onClose={() => setPrefs({ library: false })}
          onMinimize={() => setPrefs({ libraryMin: true })}
        />
      )}
      {canEdit && prefs.library && prefs.libraryMin && (
        <PanelRail
          side="left"
          label={t('library.expand')}
          icon={<LibraryBig aria-hidden />}
          badge={t('library.title')}
          onExpand={() => setPrefs({ libraryMin: false })}
        />
      )}
      {panelOpen && (
        <PropertiesPanel
          orgId={orgId}
          canEdit={canEdit}
          onEditCable={wiring.editCable}
          onClose={() => setPrefs({ panel: false })}
          onMinimize={() => setPrefs({ panelMin: true })}
        />
      )}
      {prefs.panel && prefs.panelMin && (
        <PanelRail
          side="right"
          label={t('panel.expand')}
          icon={<PanelRight aria-hidden />}
          badge={t('panel.title')}
          onExpand={() => setPrefs({ panelMin: false })}
        />
      )}
      {doc.view.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="max-w-sm text-center text-muted-foreground">
            {canEdit ? t('editorCanvas.emptyEdit') : t('editorDoc.empty')}
          </p>
        </div>
      )}
      {lens === 'l2' && meta.layer !== 'overview' && (
        <VlanLegend left={libraryOpen ? 312 : 12} bottom={60} />
      )}
      {meta.layer !== 'overview' && (
        <PageTabs
          pages={pages}
          current={page}
          canEdit={canEdit}
          counts={pageCounts}
          left={libraryOpen ? 312 : 12}
          onSelect={(id) => store.getState().setPage(id)}
          onAdd={pageActions.add}
          onRename={pageActions.rename}
          onDuplicate={pageActions.duplicate}
          onLayer={pageActions.layer}
          onMove={pageActions.move}
          onRemove={pageActions.remove}
        />
      )}
      {/* Same spot as the Problems panel: the panel wins while open. */}
      {prefs.tips && !problemsOpen && <Tips onHide={() => setPrefs({ tips: false })} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      {drill && (
        <SiteDrillDialog
          orgId={orgId}
          site={drill}
          from={diagramId}
          onClose={() => setDrill(null)}
        />
      )}
      {exporting && (
        <ExportImageDialog
          orgId={orgId}
          diagramId={diagramId}
          name={meta.name}
          onClose={() => setExporting(false)}
        />
      )}
      {quick && (
        <QuickAdd
          orgId={orgId}
          onView={onView}
          onPick={(item) => pick(item)}
          onClose={() => setQuick(false)}
        />
      )}
      {menu && (
        <NodeMenu
          x={menu.x}
          y={menu.y}
          label={t('editorEdit.menu')}
          items={menuItems(menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {edit.deleting && (
        <DeleteFromInventoryDialog
          orgId={orgId}
          diagramId={diagramId}
          doc={doc}
          target={edit.deleting}
          onConfirm={edit.confirmDelete}
          onClose={edit.cancelDelete}
        />
      )}
      {wiring.open && (
        <CableDialog
          orgId={orgId}
          doc={doc}
          a={wiring.open.a}
          b={wiring.open.b}
          initial={wiring.open.edit?.initial}
          self={wiring.open.edit?.linkId}
          onSave={wiring.save}
          onClose={wiring.close}
        />
      )}
      {creatingEndpoint && (
        <NewEndpointDialog
          orgId={orgId}
          kind={creatingEndpoint.kind}
          defaultSiteId={
            frameAt(doc, creatingEndpoint.at.x, creatingEndpoint.at.y)?.siteId ??
            defaultSiteFor(doc, lastSite)
          }
          takenNames={
            new Set(Object.values(doc.groups).map((g) => `${g.siteId}|${g.name.toLowerCase()}`))
          }
          onCreate={createEndpoint}
          onAsDevice={(kind) => {
            const at = creatingEndpoint.at
            setCreatingEndpoint(null)
            setCreating({ type: kind as DeviceType, templateId: null, at })
          }}
          onClose={() => setCreatingEndpoint(null)}
        />
      )}
      {creating && (
        <NewDeviceDialog
          orgId={orgId}
          type={creating.type}
          templateId={creating.templateId}
          defaultSiteId={
            frameAt(doc, creating.at.x, creating.at.y)?.siteId ?? defaultSiteFor(doc, lastSite)
          }
          takenHostnames={hostnames}
          onCreate={create}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
