import { Plus, Redo2, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { NativeSelect } from '@/components/NativeSelect'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { atLeast } from '@/modules/sites/access'
import { useDeviceList } from '@/modules/inventory/devices'
import { ConflictError, fetchDiagram, useDiagram, useDiagramMutations } from './doc/api'
import { addNode, removeNodes } from './doc/commands'
import { draftStore, type Draft } from './doc/drafts'
import { createDocStore } from './doc/store'
import { changesOf } from './doc/types'

const DRAFT_DELAY_MS = 600

/**
 * Diagram editor shell (P1-13): loads a diagram into the document store, keeps unsent work as an IndexedDB draft,
 * saves view + inventory changes in one request, and shows conflicts. The canvas arrives in P1-14; until then the
 * objects on the diagram are listed here.
 */
export function DiagramEditorPage() {
  const { t } = useTranslation()
  const { orgId = '', diagramId = '' } = useParams()
  const detail = useDiagram(orgId, diagramId)
  const [store] = useState(createDocStore)
  const meta = useStore(store, (s) => s.meta)
  const doc = useStore(store, (s) => s.doc)
  const status = useStore(store, (s) => s.status)
  const canUndo = useStore(store, (s) => s.past.length > 0)
  const canRedo = useStore(store, (s) => s.future.length > 0)
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
    const unsub = store.subscribe((s, prev) => {
      if (s.doc === prev.doc || s.status === 'clean' || !s.doc || !s.meta) return
      clearTimeout(timer)
      const draft: Draft = {
        diagramId,
        baseVersion: s.meta.version,
        doc: s.doc,
        savedAt: new Date().toISOString(),
      }
      timer = setTimeout(() => void draftStore().put(draft), DRAFT_DELAY_MS)
    })
    return () => {
      clearTimeout(timer)
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        saveRef.current()
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        store.getState().undo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        store.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

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
  const pending = changesOf(doc).length
  return (
    <div className="space-y-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold">{meta.name}</h1>
          <p className="text-muted-foreground">
            {t(`diagrams.layers.${meta.layer}`)}
            {meta.description && ` · ${meta.description}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-muted-foreground">
            {t(`editorDoc.status.${status}`)}
            {pending > 0 && ` · ${t('editorDoc.pending', { count: pending })}`}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('editorDoc.undo')}
            title={`${t('editorDoc.undo')} (Ctrl+Z)`}
            disabled={!canUndo}
            onClick={() => store.getState().undo()}
          >
            <Undo2 aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('editorDoc.redo')}
            title={`${t('editorDoc.redo')} (Ctrl+Shift+Z)`}
            disabled={!canRedo}
            onClick={() => store.getState().redo()}
          >
            <Redo2 aria-hidden />
          </Button>
          {canEdit && (
            <Button
              onClick={doSave}
              disabled={status === 'clean' || status === 'saving' || status === 'conflict'}
              title={`${t('editorDoc.save')} (Ctrl+S)`}
            >
              <Save aria-hidden /> {t('editorDoc.save')}
            </Button>
          )}
        </div>
      </header>
      {!canEdit && <p className="text-muted-foreground">{t('editorDoc.readOnly')}</p>}
      {offer && (
        <Alert>
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
        <Alert variant="destructive">
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
      <ObjectsPanel orgId={orgId} store={store} canEdit={canEdit} />
    </div>
  )
}

/** Stand-in for the canvas (P1-14): what is on the diagram, add from the inventory, remove from the diagram. */
function ObjectsPanel({
  orgId,
  store,
  canEdit,
}: {
  orgId: string
  store: ReturnType<typeof createDocStore>
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const doc = useStore(store, (s) => s.doc)!
  const [pick, setPick] = useState('')
  const devices = useDeviceList(orgId, {
    q: '',
    facets: {},
    categoryId: null,
    sort: { id: 'hostname', desc: false },
    pageIndex: 0,
    pageSize: 200,
  })
  const onView = useMemo(() => new Set(doc.view.nodes.map((n) => n.refId)), [doc.view.nodes])
  const notDrawn = (devices.data?.devices ?? []).filter((d) => !onView.has(d.id))
  const label = (refKind: string, refId: string) => {
    if (doc.hidden.includes(refId)) return t('editorDoc.hidden')
    if (refKind === 'device') return doc.devices[refId]?.hostname ?? refId
    if (refKind === 'endpoint_group') return doc.groups[refId]?.name ?? refId
    return refId
  }
  return (
    <section
      aria-labelledby="objects"
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="objects" className="font-semibold">
          {t('editorDoc.objects', { count: doc.view.nodes.length })}
        </h2>
        {canEdit && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const d = devices.data?.devices.find((x) => x.id === pick)
              if (!d) return
              store.getState().dispatch(
                addNode('device', d.id, doc.view.nodes.length * 160, 0, {
                  device: { id: d.id, hostname: d.hostname, type: d.type, siteId: d.siteId },
                }),
              )
              setPick('')
            }}
          >
            <NativeSelect
              aria-label={t('editorDoc.addFromInventory')}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="w-64"
            >
              <option value="">{t('editorDoc.addFromInventory')}</option>
              {notDrawn.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm" disabled={!pick}>
              <Plus aria-hidden /> {t('editorDoc.add')}
            </Button>
          </form>
        )}
      </div>
      <p className="text-muted-foreground">{t('editorDoc.canvasSoon')}</p>
      {doc.view.nodes.length === 0 ? (
        <p className="text-muted-foreground">{t('editorDoc.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {doc.view.nodes.map((n) => (
            <li key={n.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{label(n.refKind, n.refId)}</span>
                {doc.devices[n.refId]?.draft && (
                  <span className="ml-2 text-status-warning">{t('editorDoc.unsaved')}</span>
                )}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('editorDoc.removeFromDiagram')} ${label(n.refKind, n.refId)}`}
                  title={t('editorDoc.removeFromDiagram')}
                  onClick={() => store.getState().dispatch(removeNodes([n.id]))}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {doc.view.edges.length > 0 && (
        <p className="text-muted-foreground">
          {t('editorDoc.edges', { count: doc.view.edges.length })}
        </p>
      )}
    </section>
  )
}
