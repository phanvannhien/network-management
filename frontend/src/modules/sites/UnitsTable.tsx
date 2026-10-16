import { Building2, Plus } from 'lucide-react'
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
import { useBusinessUnits, usePartners, type BusinessUnit } from './sites'

const UNIT_SORT: Record<string, (u: BusinessUnit) => string | number> = {
  partner: (u) => `${u.partnerCode} ${u.code}`,
  code: (u) => u.code,
  name: (u) => u.name,
  siteCount: (u) => u.siteCount,
}

/** Business units (ADR-031); `partnerId` limits the table to one partner (partner detail page). */
export function UnitsTable({
  orgId,
  partnerId,
  canAdmin,
  onAdd,
}: {
  orgId: string
  partnerId?: string
  canAdmin: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const userId = useSession().data?.user.id ?? ''
  const units = useBusinessUnits(orgId)
  const partners = usePartners(orgId, !partnerId)
  const scope = partnerId ? 'partner-units' : 'units'
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const pf = filter.facets.partner ?? []
    return units.data?.filter(
      (u) =>
        (!partnerId || u.partnerId === partnerId) &&
        (!q || [u.code, u.name, u.partnerCode].some((v) => v.toLowerCase().includes(q))) &&
        (pf.length === 0 || pf.includes(u.partnerId)),
    )
  }, [units.data, filter, partnerId])
  const table = useLocalTable(rows, UNIT_SORT, [
    { id: partnerId ? 'code' : 'partner', desc: false },
  ])

  const facets: Facet[] = partnerId
    ? []
    : [
        {
          id: 'partner',
          label: t('units.partner'),
          options: (partners.data ?? []).map((p) => ({
            value: p.id,
            label: p.code,
            count: units.data?.filter((u) => u.partnerId === p.id).length ?? 0,
          })),
        },
      ]

  const columns: DataColumn<BusinessUnit>[] = [
    {
      id: 'partner',
      accessorKey: 'partnerCode',
      header: t('units.partner'),
      meta: { label: t('units.partner'), width: 110 },
      cell: ({ row: { original: u } }) => (
        <Link
          to={`/o/${orgId}/partners/${u.partnerId}`}
          className="hover:text-primary hover:underline"
          title={u.partnerName}
        >
          {u.partnerCode}
        </Link>
      ),
    },
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
    <DataTable
      tableId={scope}
      userId={userId}
      caption={t('units.title')}
      columns={columns}
      defaultHidden={partnerId ? ['partner'] : []}
      data={table.data}
      total={table.total}
      isLoading={units.isPending}
      error={units.error}
      getRowId={(u) => u.id}
      rowLabel={(u) => `${u.partnerCode} ${u.code}`}
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
          facets={facets}
          searchPlaceholder={t('units.searchPlaceholder')}
          storageKey={`ntb-filters:${userId}:${scope}`}
        />
      }
      empty={
        <EmptyState
          icon={<Building2 />}
          title={partnerId ? t('partners.noUnits') : t('units.emptyTitle')}
          description={partnerId ? undefined : t('units.emptyBody')}
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
  )
}
