import type { PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import { Download, Info, MoreHorizontal, Plus, SearchX, TriangleAlert, Upload } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
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
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { TechText } from '@/components/TechText'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { daysUntil, formatDate } from '@/lib/format'
import { useDeviceList } from './devices'
import {
  SAMPLE_DEVICES,
  SITES,
  TYPE_LABELS,
  type DeviceType,
  type SampleDevice,
  type SortKey,
} from './sampleDevices'

const STATUS_VALUES = ['up', 'down', 'warning', 'unknown', 'planned', 'notMonitored'] as const

/** Warranty date; amber icon within 90 days, red text once expired. */
export function WarrantyText({ date }: { date: string | null }) {
  const { t } = useTranslation()
  if (!date) return <span className="text-muted-foreground">{t('common.none')}</span>
  const days = daysUntil(date)
  if (days < 0) {
    return (
      <span className="text-status-down">
        {t('devices.warrantyExpired', { date: formatDate(date) })}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1" data-numeric>
      {days <= 90 && <TriangleAlert aria-hidden className="size-3.5 text-status-warning" />}
      {formatDate(date)}
    </span>
  )
}

function RowActions({ device, onDelete }: { device: SampleDevice; onDelete: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('table.rowActions', { name: device.hostname })}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => navigate(device.id)}>{t('devices.open')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => toast(t('devices.sampleAction'))}>
          {t('devices.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/editor')}>
          {t('devices.openDiagram')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          {t('devices.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Device list (DESIGN.md §7a) on sample data until P1-08: server-style pagination/sort/filter,
 * pinned checkbox + hostname, bulk actions, column chooser and saved filters per user.
 */
export function DeviceListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const userId = useSession().data?.user.id ?? 'anonymous'
  useBreadcrumbs([{ label: t('nav.devices') }])

  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'hostname', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [confirmDelete, setConfirmDelete] = useState<SampleDevice | null>(null)
  const [confirmBulk, setConfirmBulk] = useState<string[] | null>(null)
  const q = useDeferredValue(filter.q)

  const list = useDeviceList(orgId, {
    q,
    facets: filter.facets,
    sort: sorting[0] ? { id: sorting[0].id as SortKey, desc: sorting[0].desc } : null,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
  })

  const changeFilter = (f: FilterState) => {
    setFilter(f)
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }

  const counts = list.data?.facetCounts
  const facets: Facet[] = [
    {
      id: 'site',
      label: t('devices.site'),
      options: SITES.map((s) => ({ value: s, label: s, count: counts?.site?.[s] ?? 0 })),
    },
    {
      id: 'type',
      label: t('devices.type'),
      options: (Object.keys(TYPE_LABELS) as DeviceType[]).map((v) => ({
        value: v,
        label: TYPE_LABELS[v],
        count: counts?.type?.[v] ?? 0,
      })),
    },
    {
      id: 'status',
      label: t('devices.status'),
      options: STATUS_VALUES.map((v) => ({
        value: v,
        label: t(`status.${v}`),
        count: counts?.status?.[v] ?? 0,
      })),
    },
  ]

  const columns = useMemo<DataColumn<SampleDevice>[]>(
    () => [
      {
        id: 'hostname',
        accessorKey: 'hostname',
        header: t('devices.hostname'),
        meta: { label: t('devices.hostname'), width: 168, pin: true, alwaysVisible: true },
        cell: ({ row }) => (
          <Link
            to={row.original.id}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.hostname}
          </Link>
        ),
      },
      {
        id: 'mgmtIp',
        accessorKey: 'mgmtIp',
        header: t('devices.mgmtIp'),
        meta: { label: t('devices.mgmtIp'), width: 148 },
        cell: ({ row }) => <TechText value={row.original.mgmtIp} label={t('devices.mgmtIp')} />,
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: t('devices.type'),
        meta: { label: t('devices.type'), width: 120 },
        cell: ({ row }) => TYPE_LABELS[row.original.type],
      },
      {
        id: 'vendor',
        accessorKey: 'vendor',
        header: t('devices.vendor'),
        enableSorting: false,
        meta: { label: t('devices.vendor'), width: 100 },
      },
      {
        id: 'model',
        accessorKey: 'model',
        header: t('devices.model'),
        meta: { label: t('devices.model'), width: 160 },
      },
      {
        id: 'serial',
        accessorKey: 'serial',
        header: t('devices.serial'),
        enableSorting: false,
        meta: { label: t('devices.serial'), width: 150 },
        cell: ({ row }) =>
          row.original.serial ? (
            <TechText value={row.original.serial} label={t('devices.serial')} />
          ) : (
            <span className="text-muted-foreground">{t('common.none')}</span>
          ),
      },
      {
        id: 'site',
        accessorKey: 'site',
        header: t('devices.location'),
        meta: { label: t('devices.location'), width: 240 },
        cell: ({ row }) => (
          <span>
            {row.original.site}{' '}
            <span className="text-muted-foreground">› {row.original.location}</span>
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('devices.status'),
        meta: { label: t('devices.status'), width: 132 },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'warrantyEnd',
        accessorKey: 'warrantyEnd',
        header: t('devices.warranty'),
        meta: { label: t('devices.warranty'), width: 120 },
        cell: ({ row }) => <WarrantyText date={row.original.warrantyEnd} />,
      },
      {
        id: 'firmware',
        accessorKey: 'firmware',
        header: t('devices.firmware'),
        enableSorting: false,
        meta: { label: t('devices.firmware'), width: 150 },
      },
      {
        id: 'mac',
        accessorKey: 'mac',
        header: t('devices.mac'),
        enableSorting: false,
        meta: { label: t('devices.mac'), width: 170 },
        cell: ({ row }) => <TechText value={row.original.mac} label={t('devices.mac')} />,
      },
      {
        id: 'owner',
        accessorKey: 'owner',
        header: t('devices.owner'),
        enableSorting: false,
        meta: { label: t('devices.owner'), width: 150 },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.more')}</span>,
        enableSorting: false,
        meta: { label: t('common.more'), width: 48, alwaysVisible: true, align: 'right' },
        cell: ({ row }) => (
          <RowActions device={row.original} onDelete={() => setConfirmDelete(row.original)} />
        ),
      },
    ],
    [t],
  )

  const sample = () => toast(t('devices.sampleAction'))

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('devices.title')}
        count={list.data?.total}
        actions={
          <>
            <Button variant="outline" onClick={sample}>
              <Download aria-hidden /> {t('devices.export')}
            </Button>
            <Button variant="outline" onClick={sample}>
              <Upload aria-hidden /> {t('devices.import')}
            </Button>
            <Button onClick={sample}>
              <Plus aria-hidden /> {t('devices.add')}
            </Button>
          </>
        }
      />
      <Alert className="py-2">
        <Info aria-hidden />
        <AlertDescription>{t('devices.sampleBanner')}</AlertDescription>
      </Alert>
      <DataTable
        tableId="devices"
        userId={userId}
        caption={t('devices.title')}
        filters={
          <FilterBar
            value={filter}
            onChange={changeFilter}
            facets={facets}
            searchPlaceholder={t('devices.searchPlaceholder')}
            storageKey={`ntb-filters:${userId}:devices`}
          />
        }
        columns={columns}
        defaultHidden={['vendor', 'firmware', 'mac', 'owner']}
        data={list.data?.items}
        total={list.data?.total ?? 0}
        isLoading={list.isPending}
        error={list.error}
        getRowId={(d) => d.id}
        rowLabel={(d) => d.hostname}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={(u) => {
          setSorting(u)
          setPagination((p) => ({ ...p, pageIndex: 0 }))
        }}
        selection={selection}
        onSelectionChange={setSelection}
        maxHeight="calc(100vh - 330px)"
        empty={
          <EmptyState
            icon={<SearchX />}
            title={t('devices.emptyTitle')}
            description={t('devices.emptyBody')}
            action={
              <Button variant="outline" onClick={() => changeFilter(emptyFilter)}>
                {t('filter.clear')}
              </Button>
            }
          />
        }
        bulkActions={(ids) => (
          <>
            <Button variant="outline" size="sm" onClick={sample}>
              {t('devices.bulkEdit')}
            </Button>
            <Button variant="outline" size="sm" onClick={sample}>
              {t('devices.bulkSite')}
            </Button>
            <Button variant="outline" size="sm" onClick={sample}>
              {t('devices.bulkExport')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmBulk(ids)}>
              {t('devices.bulkDelete')}
            </Button>
          </>
        )}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('devices.deleteTitle', { name: confirmDelete?.hostname ?? '' })}
        description={t('devices.deleteBody')}
        confirmLabel={t('devices.delete')}
        onConfirm={() => {
          setConfirmDelete(null)
          sample()
        }}
      />
      <ConfirmDialog
        open={confirmBulk !== null}
        onOpenChange={(o) => !o && setConfirmBulk(null)}
        title={t('devices.bulkDeleteTitle', { count: confirmBulk?.length ?? 0 })}
        description={t('devices.bulkDeleteBody')}
        consequences={confirmBulk
          ?.slice(0, 5)
          .map((id) => SAMPLE_DEVICES.find((d) => d.id === id)?.hostname ?? id)
          .concat(
            confirmBulk.length > 5 ? [t('devices.andMore', { count: confirmBulk.length - 5 })] : [],
          )}
        confirmText={t('devices.bulkDeleteConfirm', { count: confirmBulk?.length ?? 0 })}
        confirmLabel={t('devices.bulkDeleteConfirm', { count: confirmBulk?.length ?? 0 })}
        onConfirm={() => {
          setConfirmBulk(null)
          setSelection({})
          sample()
        }}
      />
    </div>
  )
}
