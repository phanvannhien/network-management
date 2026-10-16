import { Network, Plus, Trash2 } from 'lucide-react'
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
import { atLeast, inScope, useOrgAccess, useScope } from '@/modules/sites/access'
import { useBusinessUnits, useSites } from '@/modules/sites/sites'
import {
  DIAGRAM_LAYERS,
  useDiagramMutations,
  useDiagrams,
  type DiagramLayer,
  type DiagramScope,
} from './doc/api'
import type { DiagramMeta } from './doc/types'

function scopeLabel(t: (k: 'diagrams.orgWide') => string, d: DiagramMeta): string {
  if (d.scope === 'organization') return t('diagrams.orgWide')
  if (d.scope === 'business_unit') return `${d.partnerCode} › ${d.unitCode}`
  return d.siteCode
}

function CreateDiagramDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { create } = useDiagramMutations(orgId)
  const access = useOrgAccess(orgId)
  const sites = useSites(orgId)
  const units = useBusinessUnits(orgId)
  const [f, setF] = useState({
    name: '',
    scope: 'site' as DiagramScope,
    target: '',
    layer: 'physical' as DiagramLayer,
  })
  const targets =
    f.scope === 'site'
      ? (sites.data ?? [])
          .filter((s) => atLeast(s.access, 'edit'))
          .map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))
      : f.scope === 'business_unit'
        ? (units.data ?? [])
            .filter((u) => atLeast(u.access, 'edit'))
            .map((u) => ({ id: u.id, label: `${u.partnerCode} › ${u.code} · ${u.name}` }))
        : []
  const scopes: DiagramScope[] = access.orgEdit
    ? ['site', 'business_unit', 'organization']
    : ['site', 'business_unit']
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          aria-label={t('diagrams.add')}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              {
                name: f.name.trim(),
                scope: f.scope,
                siteId: f.scope === 'site' ? f.target : null,
                businessUnitId: f.scope === 'business_unit' ? f.target : null,
                layer: f.layer,
              },
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
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('diagrams.scope')} guide={t('guides.diagramScope')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.scope}
                  onChange={(e) => {
                    const scope = e.target.value as DiagramScope
                    setF({
                      ...f,
                      scope,
                      target: '',
                      layer: scope === 'site' ? 'physical' : 'overview',
                    })
                  }}
                >
                  {scopes.map((s) => (
                    <option key={s} value={s}>
                      {t(`diagrams.scopes.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
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
          </div>
          {f.scope !== 'organization' && (
            <FormField
              label={f.scope === 'site' ? t('diagrams.site') : t('diagrams.unit')}
              required
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  required
                  value={f.target}
                  onChange={(e) => setF({ ...f, target: e.target.value })}
                >
                  <option value="">{t('diagrams.choose')}</option>
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
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
  const sites = useSites(orgId)
  const scope = useScope(orgId)
  const access = useOrgAccess(orgId)
  const { remove } = useDiagramMutations(orgId)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DiagramMeta | null>(null)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  useBreadcrumbs([{ label: t('nav.diagrams') }])
  const scoped = useMemo(() => {
    const byId = new Map((sites.data ?? []).map((s) => [s.id, s]))
    return diagrams.data?.filter((d) => {
      if (d.scope === 'organization') return inScope(scope, {})
      if (d.scope === 'business_unit') return !scope.unitId || d.businessUnitId === scope.unitId
      const s = d.siteId ? byId.get(d.siteId) : undefined
      return inScope(scope, { partnerId: s?.partnerId ?? null, unitId: s?.businessUnitId ?? null })
    })
  }, [diagrams.data, sites.data, scope])
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const scopeF = filter.facets.scope ?? []
    const layerF = filter.facets.layer ?? []
    return scoped?.filter(
      (d) =>
        (!q ||
          [d.name, d.description, d.siteCode, d.unitCode].some((v) =>
            v.toLowerCase().includes(q),
          )) &&
        (scopeF.length === 0 || scopeF.includes(d.scope)) &&
        (layerF.length === 0 || layerF.includes(d.layer)),
    )
  }, [scoped, filter])
  const table = useLocalTable(
    rows,
    { name: (d) => d.name, scope: (d) => scopeLabel(t, d), updated: (d) => d.updatedAt },
    [{ id: 'name', desc: false }],
  )
  const count = (pred: (d: DiagramMeta) => boolean) => (scoped ?? []).filter(pred).length
  const facets: Facet[] = [
    {
      id: 'scope',
      label: t('diagrams.scope'),
      options: (['organization', 'business_unit', 'site'] as DiagramScope[]).map((s) => ({
        value: s,
        label: t(`diagrams.scopes.${s}`),
        count: count((d) => d.scope === s),
      })),
    },
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
      id: 'scope',
      header: t('diagrams.scope'),
      meta: { label: t('diagrams.scope'), width: 200 },
      cell: ({ row: { original: d } }) => (
        <span>
          <span className="text-muted-foreground">{t(`diagrams.scopes.${d.scope}`)}</span>
          {d.scope !== 'organization' && ` · ${scopeLabel(t, d)}`}
        </span>
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
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('diagrams.add')}
            </Button>
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
