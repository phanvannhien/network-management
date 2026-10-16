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
import { SITE_KINDS, useBusinessUnits, useSites, type Site } from './sites'

const SITE_SORT: Record<string, (s: Site) => string | number> = {
  code: (s) => s.code,
  name: (s) => s.name,
  unit: (s) => s.businessUnitCode || '~',
  kind: (s) => s.kind,
  locationCount: (s) => s.locationCount,
  rackCount: (s) => s.rackCount,
}

/** Sites table; `unitId` limits it to one unit (unit detail page). */
export function SitesTable({
  orgId,
  unitId,
  canEdit,
  onAdd,
}: {
  orgId: string
  unitId?: string
  canEdit: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const userId = useSession().data?.user.id ?? ''
  const sites = useSites(orgId)
  const units = useBusinessUnits(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)

  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const unitF = filter.facets.unit ?? []
    const kindF = filter.facets.kind ?? []
    return sites.data?.filter(
      (s) =>
        (!unitId || s.businessUnitId === unitId) &&
        (!q || [s.code, s.name, s.address].some((v) => v.toLowerCase().includes(q))) &&
        (unitF.length === 0 || unitF.includes(s.businessUnitId ?? 'shared')) &&
        (kindF.length === 0 || kindF.includes(s.kind)),
    )
  }, [sites.data, filter, unitId])
  const table = useLocalTable(rows, SITE_SORT, [{ id: 'code', desc: false }])

  const count = (pred: (s: Site) => boolean) => sites.data?.filter(pred).length ?? 0
  const facets: Facet[] = [
    ...(unitId
      ? []
      : [
          {
            id: 'unit',
            label: t('sites.unit'),
            options: [
              ...(units.data ?? []).map((u) => ({
                value: u.id,
                label: u.code,
                count: count((s) => s.businessUnitId === u.id),
              })),
              {
                value: 'shared',
                label: t('units.sharedShort'),
                count: count((s) => s.businessUnitId === null),
              },
            ],
          },
        ]),
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
      meta: { label: t('sites.code'), width: 140, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          to={`/o/${orgId}/sites/${row.original.id}`}
          className="font-medium hover:text-primary hover:underline"
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
      id: 'unit',
      accessorFn: (s) => s.businessUnitCode,
      header: t('sites.unit'),
      meta: { label: t('sites.unit'), width: 130 },
      cell: ({ row: { original: s } }) =>
        s.businessUnitId ? (
          <Link
            to={`/o/${orgId}/units/${s.businessUnitId}`}
            className="hover:text-primary hover:underline"
            title={s.businessUnitName}
          >
            {s.businessUnitCode}
          </Link>
        ) : (
          <span className="text-muted-foreground">{t('units.sharedShort')}</span>
        ),
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
      tableId={unitId ? 'unit-sites' : 'sites'}
      userId={userId}
      caption={t('sites.title')}
      columns={columns}
      defaultHidden={unitId ? ['isp', 'unit'] : ['isp']}
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
          storageKey={`ntb-filters:${userId}:${unitId ? 'unit-sites' : 'sites'}`}
        />
      }
      empty={
        <EmptyState
          icon={<MapPin />}
          title={unitId ? t('units.noSites') : t('sites.emptyTitle')}
          description={unitId ? undefined : t('sites.emptyBody')}
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
