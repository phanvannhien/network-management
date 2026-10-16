import { MapPin, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
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
import { SiteFormDialog } from './SiteFormDialog'
import { useSites, type Site } from './sites'

const SITE_SORT: Record<string, (s: Site) => string | number> = {
  code: (s) => s.code,
  name: (s) => s.name,
  locationCount: (s) => s.locationCount,
  rackCount: (s) => s.rackCount,
}

/**
 * Sites of the organization (P1-07, ADR-025), filtered by the member's site scope on the server.
 * Each site groups its locations, racks, devices (P1-08) and diagrams (P1-13).
 */
export function SiteListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const userId = useSession().data?.user.id ?? ''
  const org = useOrganization(orgId)
  const sites = useSites(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [creating, setCreating] = useState(false)
  useBreadcrumbs([{ label: t('sites.title') }])

  const role = org.data?.membership.role
  const canEdit = role === 'owner' || role === 'admin' || role === 'editor'

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    return sites.data?.filter(
      (s) => !q || [s.code, s.name, s.address].some((v) => v.toLowerCase().includes(q)),
    )
  }, [sites.data, filter])
  const table = useLocalTable(filtered, SITE_SORT, [{ id: 'code', desc: false }])

  const columns: DataColumn<Site>[] = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('sites.code'),
      meta: { label: t('sites.code'), width: 120, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <Link to={row.original.id} className="font-medium hover:text-primary hover:underline">
          {row.original.code}
        </Link>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('sites.name'),
      meta: { label: t('sites.name'), width: 220 },
    },
    {
      id: 'address',
      accessorKey: 'address',
      header: t('sites.address'),
      enableSorting: false,
      meta: { label: t('sites.address'), width: 280 },
      cell: ({ row }) =>
        row.original.address || <span className="text-muted-foreground">{t('common.none')}</span>,
    },
    {
      id: 'contact',
      header: t('sites.contact'),
      enableSorting: false,
      meta: { label: t('sites.contact'), width: 220 },
      cell: ({ row: { original: s } }) =>
        s.contactName || s.contactPhone ? (
          <span>
            {s.contactName}{' '}
            {s.contactPhone && <span className="text-muted-foreground">· {s.contactPhone}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'locationCount',
      accessorKey: 'locationCount',
      header: t('sites.locations'),
      meta: { label: t('sites.locations'), width: 100, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.locationCount}</span>,
    },
    {
      id: 'rackCount',
      accessorKey: 'rackCount',
      header: t('sites.racks'),
      meta: { label: t('sites.racks'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.rackCount}</span>,
    },
    {
      id: 'timezone',
      accessorKey: 'timezone',
      header: t('sites.timezone'),
      enableSorting: false,
      meta: { label: t('sites.timezone'), width: 170 },
      cell: ({ row }) => <span className="font-mono text-tech">{row.original.timezone}</span>,
    },
  ]

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('sites.title')}
        count={sites.data?.length}
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('sites.add')}
            </Button>
          )
        }
      />
      <DataTable
        tableId="sites"
        userId={userId}
        caption={t('sites.title')}
        columns={columns}
        defaultHidden={['timezone']}
        data={table.data}
        total={table.total}
        isLoading={sites.isPending}
        error={sites.error}
        getRowId={(s) => s.id}
        rowLabel={(s) => s.code}
        pagination={table.pagination}
        onPaginationChange={table.onPaginationChange}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        maxHeight="calc(100vh - 220px)"
        filters={
          <FilterBar
            value={filter}
            onChange={(f) => {
              setFilter(f)
              table.resetPage()
            }}
            facets={[]}
            searchPlaceholder={t('sites.searchPlaceholder')}
            storageKey={`ntb-filters:${userId}:sites`}
          />
        }
        empty={
          <EmptyState
            icon={<MapPin />}
            title={t('sites.emptyTitle')}
            description={t('sites.emptyBody')}
            action={
              canEdit && (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('sites.add')}
                </Button>
              )
            }
          />
        }
      />
      {creating && (
        <SiteFormDialog
          orgId={orgId}
          open
          onClose={() => setCreating(false)}
          onSaved={(s) => navigate(s.id)}
        />
      )}
    </div>
  )
}
