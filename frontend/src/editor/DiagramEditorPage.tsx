import { ReactFlowProvider, useReactFlow, useStore as useFlowStore } from '@xyflow/react'
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
import { addNode, createDevice, removeNodes } from './doc/commands'
import { draftStore, type Draft } from './doc/drafts'
import { createDocStore, type DocStoreApi } from './doc/store'
import { changesOf } from './doc/types'
import type { DeviceType, LibraryItem } from './library/items'
import { LibraryPanel } from './library/LibraryPanel'
import { defaultSiteFor } from './library/placement'
import { NewDeviceDialog, type NewDeviceInput } from './library/NewDeviceDialog'
import { QuickAdd } from './library/QuickAdd'
import { Canvas } from './workspace/Canvas'
import { fitOptions } from './workspace/flow'
import { DocStoreContext } from './workspace/context'
import { useEditorPrefs } from './workspace/prefs'
import { actionFor, CANVAS_ONLY, isTyping } from './workspace/shortcuts'
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
  const [lastSite, setLastSite] = useState<string | null>(null)
  const onView = useMemo(() => new Set(doc.view.nodes.map((n) => n.refId)), [doc.view.nodes])
  const hostnames = useMemo(
    () => new Set(Object.values(doc.devices).map((d) => d.hostname)),
    [doc.devices],
  )
  const libraryOpen = canEdit && prefs.library

  const fit = () => void flow.fitView({ ...fitOptions(libraryOpen), duration: ZOOM_MS })
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
      store.getState().dispatch(addNode('device', item.device.id, x, y, { device: item.device }))
      return
    }
    setCreating({
      type: item.type,
      templateId: item.kind === 'template' ? item.templateId : null,
      at,
    })
  }
  const create = (input: NewDeviceInput) => {
    if (!creating) return
    const { x, y } = place(creating.at)
    store.getState().dispatch(
      createDevice(
        {
          hostname: input.hostname,
          type: input.type,
          siteId: input.siteId,
          templateId: input.templateId,
        },
        x,
        y,
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
          break
        case 'remove':
          if (!canEdit || s.selection.length === 0) return
          s.dispatch(removeNodes(s.selection))
          break
        case 'quickAdd':
          if (!canEdit) return
          setQuick(true)
          break
        case 'library':
          if (!canEdit) return
          setPrefs({ library: !prefs.library })
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

  return (
    <div ref={root} className="contents">
      <Canvas
        diagramId={diagramId}
        canEdit={canEdit}
        prefs={prefs}
        libraryOpen={libraryOpen}
        onDropItem={pick}
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
      />
      {libraryOpen && (
        <LibraryPanel
          orgId={orgId}
          onView={onView}
          onPick={(item) => pick(item)}
          onClose={() => setPrefs({ library: false })}
        />
      )}
      {doc.view.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="max-w-sm text-center text-muted-foreground">
            {canEdit ? t('editorCanvas.emptyEdit') : t('editorDoc.empty')}
          </p>
        </div>
      )}
      {prefs.tips && <Tips onHide={() => setPrefs({ tips: false })} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      {quick && (
        <QuickAdd
          orgId={orgId}
          onView={onView}
          onPick={(item) => pick(item)}
          onClose={() => setQuick(false)}
        />
      )}
      {creating && (
        <NewDeviceDialog
          orgId={orgId}
          type={creating.type}
          templateId={creating.templateId}
          defaultSiteId={defaultSiteFor(doc, lastSite)}
          takenHostnames={hostnames}
          onCreate={create}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
