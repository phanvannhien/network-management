import { Handshake, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSession } from '@/app/auth'
import { useOrganization } from '@/app/orgs'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { useLocalTable } from '@/components/localTable'
import { Button } from '@/components/ui/button'
import { useScope } from './access'
import { PARTNER_RELATIONS, usePartners, type Partner } from './sites'

const PARTNER_SORT: Record<string, (p: Partner) => string | number> = {
  code: (p) => p.code,
  name: (p) => p.name,
  relation: (p) => p.relation,
  unitCount: (p) => p.unitCount,
  siteCount: (p) => p.siteCount,
}

/** Partners of the organization (ADR-031) with their unit / site counts. */
export function PartnersTable({
  orgId,
  canAdmin,
  onAdd,
}: {
  orgId: string
  canAdmin: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const orgName = useOrganization(orgId).data?.organization.name ?? ''
  const userId = useSession().data?.user.id ?? ''
  const partners = usePartners(orgId)
  const scope = useScope(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const rel = filter.facets.relation ?? []
    return partners.data?.filter(
      (p) =>
        (!scope.partnerId || p.id === scope.partnerId) &&
        (!q || [p.code, p.name].some((v) => v.toLowerCase().includes(q))) &&
        (rel.length === 0 || rel.includes(p.relation)),
    )
  }, [partners.data, filter, scope.partnerId])
  const table = useLocalTable(rows, PARTNER_SORT, [{ id: 'code', desc: false }])

  const columns: DataColumn<Partner>[] = [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('partners.code'),
      meta: { label: t('partners.code'), width: 120, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          to={`/o/${orgId}/partners/${row.original.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {row.original.code}
        </Link>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('partners.name'),
      meta: { label: t('partners.name'), width: 260 },
    },
    {
      id: 'relation',
      accessorKey: 'relation',
      header: t('partners.relationWith', { org: orgName }),
      meta: { label: t('partners.relationWith', { org: orgName }), width: 180 },
      cell: ({ row }) => t(`partners.relations.${row.original.relation}`),
    },
    {
      id: 'contact',
      header: t('partners.contact'),
      enableSorting: false,
      meta: { label: t('partners.contact'), width: 240 },
      cell: ({ row: { original: p } }) =>
        p.contactName || p.contactPhone || p.contactEmail ? (
          <span>
            {p.contactName}{' '}
            <span className="text-muted-foreground">
              {[p.contactPhone, p.contactEmail].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'unitCount',
      accessorKey: 'unitCount',
      header: t('partners.units'),
      meta: { label: t('partners.units'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.unitCount}</span>,
    },
    {
      id: 'siteCount',
      accessorKey: 'siteCount',
      header: t('partners.sites'),
      meta: { label: t('partners.sites'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.siteCount}</span>,
    },
  ]

  return (
    <DataTable
      tableId="partners"
      userId={userId}
      caption={t('partners.title')}
      columns={columns}
      data={table.data}
      total={table.total}
      isLoading={partners.isPending}
      error={partners.error}
      getRowId={(p) => p.id}
      rowLabel={(p) => p.code}
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
              label: t('partners.relation'),
              options: PARTNER_RELATIONS.map((r) => ({
                value: r,
                label: t(`partners.relations.${r}`),
                count: partners.data?.filter((p) => p.relation === r).length ?? 0,
              })),
            },
          ]}
          searchPlaceholder={t('partners.searchPlaceholder')}
          storageKey={`ntb-filters:${userId}:partners`}
        />
      }
      empty={
        <EmptyState
          icon={<Handshake />}
          title={t('partners.emptyTitle')}
          description={t('partners.emptyBody')}
          action={
            canAdmin && (
              <Button onClick={onAdd}>
                <Plus aria-hidden /> {t('partners.add')}
              </Button>
            )
          }
        />
      }
    />
  )
}
