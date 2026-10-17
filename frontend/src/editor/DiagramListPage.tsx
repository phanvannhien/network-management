import { FileUp, LayoutTemplate, Network, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar, type Facet } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { FormField } from '@/components/FormField'
import { useLocalTable } from '@/components/localTable'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import { atLeast, useOrgAccess } from '@/modules/sites/access'
import { DIAGRAM_LAYERS, useDiagramMutations, useDiagrams, type DiagramLayer } from './doc/api'
import type { DiagramMeta } from './doc/types'
import { DesignTemplateDialog } from './DesignTemplateDialog'
import { OverviewDialog } from './overview/OverviewDialog'
import { NtbImportDialog } from './NtbImportDialog'

function CreateDiagramDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { create } = useDiagramMutations(orgId)
  const [f, setF] = useState({ name: '', layer: 'physical' as DiagramLayer })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          aria-label={t('diagrams.add')}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              { name: f.name.trim(), layer: f.layer },
              {
                onSuccess: (d) => {
                  toast.success(t('diagrams.created'))
                  navigate(`/o/${orgId}/diagrams/${d.diagram.id}`)
                },
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('diagrams.add')}</DialogTitle>
          </DialogHeader>
          <FormField label={t('diagrams.name')} required hint={t('diagrams.nameHint')}>
            {(p) => (
              <Input
                {...p}
                required
                autoFocus
                maxLength={120}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            )}
          </FormField>
          <FormField label={t('diagrams.layer')} guide={t('guides.diagramLayer')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={f.layer}
                onChange={(e) => setF({ ...f, layer: e.target.value as DiagramLayer })}
              >
                {DIAGRAM_LAYERS.map((l) => (
                  <option key={l} value={l}>
                    {t(`diagrams.layers.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {create.isError && (
            <p role="alert" className="text-destructive">
              {create.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('diagrams.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Diagrams of the organization (P1-13, ADR-028): organization / unit overviews and site details. */
export function DiagramListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const userId = useSession().data?.user.id ?? ''
  const diagrams = useDiagrams(orgId)
  const access = useOrgAccess(orgId)
  const { remove } = useDiagramMutations(orgId)
  const [importing, setImporting] = useState(false)
  const [designing, setDesigning] = useState(false)
  const [overview, setOverview] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DiagramMeta | null>(null)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  useBreadcrumbs([{ label: t('nav.diagrams') }])
  const scoped = diagrams.data
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const layerF = filter.facets.layer ?? []
    return scoped?.filter(
      (d) =>
        (!q || [d.name, d.description].some((v) => v.toLowerCase().includes(q))) &&
        (layerF.length === 0 || layerF.includes(d.layer)),
    )
  }, [scoped, filter])
  const table = useLocalTable(rows, { name: (d) => d.name, updated: (d) => d.updatedAt }, [
    { id: 'name', desc: false },
  ])
  const count = (pred: (d: DiagramMeta) => boolean) => (scoped ?? []).filter(pred).length
  const facets: Facet[] = [
    {
      id: 'layer',
      label: t('diagrams.layer'),
      options: DIAGRAM_LAYERS.map((l) => ({
        value: l,
        label: t(`diagrams.layers.${l}`),
        count: count((d) => d.layer === l),
      })),
    },
  ]
  const columns: DataColumn<DiagramMeta>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t('diagrams.name'),
      meta: { label: t('diagrams.name'), width: 260, pin: true, alwaysVisible: true },
      cell: ({ row: { original: d } }) => (
        <Link
          to={`/o/${orgId}/diagrams/${d.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {d.name}
        </Link>
      ),
    },
    {
      id: 'layer',
      accessorKey: 'layer',
      header: t('diagrams.layer'),
      enableSorting: false,
      meta: { label: t('diagrams.layer'), width: 140 },
      cell: ({ row }) => t(`diagrams.layers.${row.original.layer}`),
    },
    {
      id: 'nodes',
      accessorKey: 'nodeCount',
      header: t('diagrams.nodes'),
      enableSorting: false,
      meta: { label: t('diagrams.nodes'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.nodeCount}</span>,
    },
    {
      id: 'updated',
      header: t('diagrams.updated'),
      meta: { label: t('diagrams.updated'), width: 140 },
      cell: ({ row }) => formatDate(row.original.updatedAt),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { label: t('table.actions'), width: 60, alwaysVisible: true },
      cell: ({ row: { original: d } }) =>
        atLeast(d.access, 'edit') && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t('diagrams.delete')} ${d.name}`}
            onClick={() => setDeleting(d)}
          >
            <Trash2 aria-hidden />
          </Button>
        ),
    },
  ]
  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('diagrams.title')}
        description={t('diagrams.subtitle')}
        actions={
          access.canAddSites && (
            <>
              <Button variant="outline" onClick={() => setOverview(true)}>
                <Network aria-hidden /> {t('overview.open')}
              </Button>
              <Button variant="outline" onClick={() => setDesigning(true)}>
                <LayoutTemplate aria-hidden /> {t('design.open')}
              </Button>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp aria-hidden /> {t('ntbImport.open')}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> {t('diagrams.add')}
              </Button>
            </>
          )
        }
      />
      <DataTable
        tableId="diagrams"
        userId={userId}
        caption={t('diagrams.title')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={diagrams.isPending}
        error={diagrams.error}
        getRowId={(d) => d.id}
        rowLabel={(d) => d.name}
        pagination={table.pagination}
        onPaginationChange={table.onPaginationChange}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        maxHeight="calc(100vh - 260px)"
        filters={
          <FilterBar
            value={filter}
            onChange={(f) => {
              setFilter(f)
              table.resetPage()
            }}
            facets={facets}
            searchPlaceholder={t('diagrams.search')}
            storageKey={`ntb-filters:${userId}:diagrams`}
          />
        }
        empty={
          <EmptyState
            icon={<Network />}
            title={t('diagrams.emptyTitle')}
            description={t('diagrams.emptyBody')}
            action={
              access.canAddSites && (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('diagrams.add')}
                </Button>
              )
            }
          />
        }
      />
      {creating && <CreateDiagramDialog orgId={orgId} onClose={() => setCreating(false)} />}
      {importing && <NtbImportDialog orgId={orgId} onClose={() => setImporting(false)} />}
      {designing && <DesignTemplateDialog orgId={orgId} onClose={() => setDesigning(false)} />}
      {overview && <OverviewDialog orgId={orgId} onClose={() => setOverview(false)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('diagrams.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('diagrams.deleteBody')}
        confirmLabel={t('diagrams.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(t('diagrams.deleted')),
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
