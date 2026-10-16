import { Building2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useSession } from '@/app/auth'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { useLocalTable } from '@/components/localTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SiteFormDialog } from './SiteFormDialog'
import { SitesTable } from './SitesTable'
import { useBusinessUnits, useSites, type BusinessUnit } from './sites'
import { UnitFormDialog } from './UnitFormDialog'

const UNIT_SORT: Record<string, (u: BusinessUnit) => string | number> = {
  code: (u) => u.code,
  name: (u) => u.name,
  relation: (u) => u.relation,
  siteCount: (u) => u.siteCount,
}

function UnitsTable({
  orgId,
  canAdmin,
  onAdd,
}: {
  orgId: string
  canAdmin: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const userId = useSession().data?.user.id ?? ''
  const units = useBusinessUnits(orgId)
  const sites = useSites(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const rel = filter.facets.relation ?? []
    return units.data?.filter(
      (u) =>
        (!q || [u.code, u.name].some((v) => v.toLowerCase().includes(q))) &&
        (rel.length === 0 || rel.includes(u.relation)),
    )
  }, [units.data, filter])
  const table = useLocalTable(rows, UNIT_SORT, [{ id: 'code', desc: false }])
  const sharedCount = sites.data?.filter((s) => s.businessUnitId === null).length ?? 0

  const columns: DataColumn<BusinessUnit>[] = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('units.code'),
      meta: { label: t('units.code'), width: 120, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          to={`/o/${orgId}/units/${row.original.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {row.original.code}
        </Link>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('units.name'),
      meta: { label: t('units.name'), width: 260 },
    },
    {
      id: 'relation',
      accessorKey: 'relation',
      header: t('units.relation'),
      meta: { label: t('units.relation'), width: 140 },
      cell: ({ row }) => t(`units.relations.${row.original.relation}`),
    },
    {
      id: 'contact',
      header: t('units.contact'),
      enableSorting: false,
      meta: { label: t('units.contact'), width: 260 },
      cell: ({ row: { original: u } }) =>
        u.contactName || u.contactPhone || u.contactEmail ? (
          <span>
            {u.contactName}{' '}
            <span className="text-muted-foreground">
              {[u.contactPhone, u.contactEmail].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'siteCount',
      accessorKey: 'siteCount',
      header: t('units.sites'),
      meta: { label: t('units.sites'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.siteCount}</span>,
    },
  ]

  return (
    <div className="space-y-2">
      <DataTable
        tableId="units"
        userId={userId}
        caption={t('units.title')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={units.isPending}
        error={units.error}
        getRowId={(u) => u.id}
        rowLabel={(u) => u.code}
        pagination={table.pagination}
        onPaginationChange={table.onPaginationChange}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        maxHeight="calc(100vh - 300px)"
        filters={
          <FilterBar
            value={filter}
            onChange={(f) => {
              setFilter(f)
              table.resetPage()
            }}
            facets={[
              {
                id: 'relation',
                label: t('units.relation'),
                options: (['subsidiary', 'partner', 'customer'] as const).map((r) => ({
                  value: r,
                  label: t(`units.relations.${r}`),
                  count: units.data?.filter((u) => u.relation === r).length ?? 0,
                })),
              },
            ]}
            searchPlaceholder={t('units.searchPlaceholder')}
            storageKey={`ntb-filters:${userId}:units`}
          />
        }
        empty={
          <EmptyState
            icon={<Building2 />}
            title={t('units.emptyTitle')}
            description={t('units.emptyBody')}
            action={
              canAdmin && (
                <Button onClick={onAdd}>
                  <Plus aria-hidden /> {t('units.add')}
                </Button>
              )
            }
          />
        }
      />
      <p className="text-muted-foreground">
        <Link to={`/o/${orgId}/sites?tab=sites`} className="hover:text-foreground hover:underline">
          {t('units.sharedShort')}: {sharedCount} {t('units.sites').toLowerCase()}
        </Link>{' '}
        — {t('units.sharedHint')}
      </p>
    </div>
  )
}

/**
 * "Đơn vị & Sites" (SRS §2, ADR-026): business units of the organization and all its sites. Sites are
 * filtered by the member's site scope on the server.
 */
export function SiteListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const org = useOrganization(orgId)
  const [creating, setCreating] = useState<'unit' | 'site' | null>(null)
  const tab = params.get('tab') === 'sites' ? 'sites' : 'units'
  useBreadcrumbs([{ label: t('units.hub') }])

  const role = org.data?.membership.role
  const canAdmin = role === 'owner' || role === 'admin'
  const canEdit = canAdmin || role === 'editor'

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('units.hub')}
        actions={
          <>
            {canAdmin && (
              <Button
                variant={tab === 'units' ? 'default' : 'outline'}
                onClick={() => setCreating('unit')}
              >
                <Plus aria-hidden /> {t('units.add')}
              </Button>
            )}
            {canEdit && (
              <Button
                variant={tab === 'sites' ? 'default' : 'outline'}
                onClick={() => setCreating('site')}
              >
                <Plus aria-hidden /> {t('sites.add')}
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}>
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="units">{t('units.tabUnits')}</TabsTrigger>
          <TabsTrigger value="sites">{t('units.tabSites')}</TabsTrigger>
        </TabsList>
        <TabsContent value="units" className="pt-3">
          <UnitsTable orgId={orgId} canAdmin={canAdmin} onAdd={() => setCreating('unit')} />
        </TabsContent>
        <TabsContent value="sites" className="pt-3">
          <SitesTable orgId={orgId} canEdit={canEdit} onAdd={() => setCreating('site')} />
        </TabsContent>
      </Tabs>
      {creating === 'unit' && (
        <UnitFormDialog
          orgId={orgId}
          onClose={() => setCreating(null)}
          onSaved={(u) => navigate(`/o/${orgId}/units/${u.id}`)}
        />
      )}
      {creating === 'site' && (
        <SiteFormDialog
          orgId={orgId}
          open
          onClose={() => setCreating(null)}
          onSaved={(s) => navigate(`/o/${orgId}/sites/${s.id}`)}
        />
      )}
    </div>
  )
}
