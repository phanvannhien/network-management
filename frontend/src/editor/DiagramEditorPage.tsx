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
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { atLeast } from '@/modules/sites/access'
import { ConflictError, fetchDiagram, useDiagram, useDiagramMutations } from './doc/api'
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
import { ProblemsPanel } from './checks/ProblemsPanel'
import { countProblems } from './checks/types'
import { useChecks } from './checks/useChecks'
import { fitOptions } from './workspace/flow'
import { DocStoreContext } from './workspace/context'
import { togglePanel, useEditorPrefs } from './workspace/prefs'
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
  useBreadcrumbs([
    { label: t('nav.diagrams'), to: `/o/${orgId}/diagrams` },
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
  const onView = useMemo(() => new Set(doc.view.nodes.map((n) => n.refId)), [doc.view.nodes])
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
  const [menu, setMenu] = useState<{
    x: number
    y: number
    kind: 'node' | 'edge' | 'pane'
    id?: string
  } | null>(null)

  const fit = () => void flow.fitView({ ...fitOptions(libraryOpen, panelOpen), duration: ZOOM_MS })
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
          s.setSelection(s.doc?.view.nodes.map((n) => n.id) ?? [])
          break
        case 'deselect':
          s.setSelection([])
          s.setEdgeSelection([])
          setMenu(null)
          wiring.cancel()
          break
        case 'connect':
          if (!canEdit) return
          setHand(false)
          wiring.toggle()
          break
        case 'hand':
          wiring.cancel()
          setHand((h) => !h)
          break
        case 'pointer':
          wiring.cancel()
          setHand(false)
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
          annotate.frame()
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
          onSelect: () => store.getState().setSelection(doc.view.nodes.map((n) => n.id)),
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
        onQuickAdd={() => setQuick(true)}
        onAddFrame={annotate.frame}
        onAddText={annotate.text}
        onAddArrow={annotate.arrow}
        connecting={wiring.mode !== null}
        onConnect={() => {
          setHand(false)
          wiring.toggle()
        }}
        hand={hand}
        onHand={() => {
          wiring.cancel()
          setHand((h) => !h)
        }}
        onPointer={() => {
          wiring.cancel()
          setHand(false)
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
      {/* Same spot as the Problems panel: the panel wins while open. */}
      {prefs.tips && !problemsOpen && <Tips onHide={() => setPrefs({ tips: false })} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
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
