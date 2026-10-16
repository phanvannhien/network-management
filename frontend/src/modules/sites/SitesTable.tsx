import { MapPin, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSession } from '@/app/auth'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar, type Facet } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { useLocalTable } from '@/components/localTable'
import { Button } from '@/components/ui/button'
import { useInScope } from './access'
import { SITE_KINDS, subtreeIds, useCategories, useSites, type Site } from './sites'

const SITE_SORT: Record<string, (s: Site) => string | number> = {
  code: (s) => s.code,
  name: (s) => s.name,
  category: (s) => s.categoryPath || '~',
  kind: (s) => s.kind,
  locationCount: (s) => s.locationCount,
  rackCount: (s) => s.rackCount,
}

/**
 * Sites table (ADR-032). `categoryId` limits it to a category branch; `'root'` to the sites straight under the
 * organization; undefined shows everything (still narrowed by the topbar filter).
 */
export function SitesTable({
  orgId,
  categoryId,
  canEdit,
  onAdd,
}: {
  orgId: string
  categoryId?: string | 'root'
  canEdit: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const userId = useSession().data?.user.id ?? ''
  const sites = useSites(orgId)
  const categories = useCategories(orgId)
  const passes = useInScope(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const branch = useMemo(
    () =>
      categoryId && categoryId !== 'root' && categories.data
        ? subtreeIds(categories.data, categoryId)
        : null,
    [categoryId, categories.data],
  )

  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const kindF = filter.facets.kind ?? []
    return sites.data?.filter(
      (s) =>
        (categoryId === undefined
          ? passes(s.categoryId)
          : categoryId === 'root'
            ? s.categoryId === null
            : !!s.categoryId && !!branch?.has(s.categoryId)) &&
        (!q ||
          [s.code, s.name, s.address, s.categoryPath].some((v) => v.toLowerCase().includes(q))) &&
        (kindF.length === 0 || kindF.includes(s.kind)),
    )
  }, [sites.data, filter, categoryId, branch, passes])
  const table = useLocalTable(rows, SITE_SORT, [{ id: 'code', desc: false }])

  const count = (pred: (s: Site) => boolean) => (rows ?? []).filter(pred).length
  const facets: Facet[] = [
    {
      id: 'kind',
      label: t('sites.kind'),
      options: SITE_KINDS.map((k) => ({
        value: k,
        label: t(`sites.siteKinds.${k}`),
        count: count((s) => s.kind === k),
      })),
    },
  ]

  const columns: DataColumn<Site>[] = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('sites.code'),
      meta: { label: t('sites.code'), width: 220, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          to={`/o/${orgId}/sites/${row.original.id}`}
          className="font-mono text-tech font-medium hover:text-primary hover:underline"
        >
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
      id: 'category',
      accessorFn: (s) => s.categoryPath,
      header: t('sites.category'),
      meta: { label: t('sites.category'), width: 220 },
      cell: ({ row: { original: s } }) =>
        s.categoryPath || <span className="text-muted-foreground">{t('categories.orgShort')}</span>,
    },
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t('sites.kind'),
      meta: { label: t('sites.kind'), width: 150 },
      cell: ({ row }) => t(`sites.siteKinds.${row.original.kind}`),
    },
    {
      id: 'address',
      accessorKey: 'address',
      header: t('sites.address'),
      enableSorting: false,
      meta: { label: t('sites.address'), width: 260 },
      cell: ({ row }) =>
        row.original.address || <span className="text-muted-foreground">{t('common.none')}</span>,
    },
    {
      id: 'isp',
      accessorKey: 'isp',
      header: t('sites.isp'),
      enableSorting: false,
      meta: { label: t('sites.isp'), width: 160 },
      cell: ({ row }) =>
        row.original.isp || <span className="text-muted-foreground">{t('common.none')}</span>,
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
      meta: { label: t('sites.racks'), width: 80, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.rackCount}</span>,
    },
  ]

  return (
    <DataTable
      tableId="sites"
      userId={userId}
      caption={t('sites.title')}
      columns={columns}
      defaultHidden={categoryId ? ['isp', 'category'] : ['isp']}
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
      maxHeight="calc(100vh - 260px)"
      filters={
        <FilterBar
          value={filter}
          onChange={(f) => {
            setFilter(f)
            table.resetPage()
          }}
          facets={facets}
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
              <Button onClick={onAdd}>
                <Plus aria-hidden /> {t('sites.add')}
              </Button>
            )
          }
        />
      }
    />
  )
}
