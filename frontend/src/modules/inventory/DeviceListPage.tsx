import type { PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import { MoreHorizontal, Plus, SearchX, Server, TriangleAlert } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar, type Facet } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { PageHeader } from '@/components/PageHeader'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { daysUntil, formatDate } from '@/lib/format'
import { atLeast, useOrgAccess, useScope } from '@/modules/sites/access'
import { useSites } from '@/modules/sites/sites'
import { BulkEditDialog } from './BulkEditDialog'
import { DeviceFormDialog } from './DeviceFormDialog'
import { EndpointGroupDialog, EndpointGroupsTable } from './EndpointGroups'
import {
  DEVICE_TYPES,
  LIFECYCLES,
  useClusters,
  useDeleteDevices,
  useDeviceList,
  type Device,
  type DeviceSort,
} from './devices'

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

function RowActions({
  device,
  onEdit,
  onDelete,
}: {
  device: Device
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canEdit = atLeast(device.access, 'edit')
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
        {canEdit && <DropdownMenuItem onClick={onEdit}>{t('devices.edit')}</DropdownMenuItem>}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              {t('devices.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Device inventory (P1-08, DESIGN.md §7a): server-side filters / sort / pages, facet counts from the server,
 * the topbar partner / unit filter, column chooser and saved filters per user, bulk edit and delete.
 */
export function DeviceListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const userId = useSession().data?.user.id ?? 'anonymous'
  const access = useOrgAccess(orgId)
  const scope = useScope(orgId)
  const sites = useSites(orgId)
  const clusters = useClusters(orgId)
  useBreadcrumbs([{ label: t('nav.devices') }])
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'groups' ? 'groups' : 'devices'
  const [creatingGroup, setCreatingGroup] = useState(false)

  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'hostname', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [editing, setEditing] = useState<Device | 'new' | null>(null)
  const [bulkEdit, setBulkEdit] = useState<string[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Device[] | null>(null)
  const del = useDeleteDevices(orgId)
  const q = useDeferredValue(filter.q)

  const list = useDeviceList(orgId, {
    q,
    facets: filter.facets,
    categoryId: scope.categoryId,
    sort: sorting[0] ? { id: sorting[0].id as DeviceSort, desc: sorting[0].desc } : null,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
  })
  const rows = list.data?.devices
  const byId = useMemo(() => new Map((rows ?? []).map((d) => [d.id, d])), [rows])

  const changeFilter = (f: FilterState) => {
    setFilter(f)
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }

  const counts = list.data?.facets
  const valuesOf = (facet: string) => Object.keys(counts?.[facet] ?? {})
  const facets: Facet[] = [
    {
      id: 'site',
      label: t('devices.site'),
      options: (sites.data ?? []).map((s) => ({
        value: s.id,
        label: s.code,
        count: counts?.site?.[s.id] ?? 0,
      })),
    },
    {
      id: 'type',
      label: t('devices.type'),
      options: DEVICE_TYPES.filter(
        (v) => (counts?.type?.[v] ?? 0) > 0 || filter.facets.type?.includes(v),
      ).map((v) => ({ value: v, label: t(`devices.types.${v}`), count: counts?.type?.[v] ?? 0 })),
    },
    {
      id: 'lifecycle',
      label: t('devices.lifecycle'),
      options: LIFECYCLES.map((v) => ({
        value: v,
        label: t(`devices.lifecycleValues.${v}`),
        count: counts?.lifecycle?.[v] ?? 0,
      })),
    },
    {
      id: 'vendor',
      label: t('devices.vendor'),
      options: valuesOf('vendor')
        .filter(Boolean)
        .sort()
        .map((v) => ({ value: v, label: v, count: counts?.vendor?.[v] ?? 0 })),
    },
    // Only when the organization has clusters, to keep the bar on one line otherwise.
    ...((clusters.data ?? []).length > 0
      ? [
          {
            id: 'cluster',
            label: t('clusters.filter'),
            options: (clusters.data ?? []).map((c) => ({
              value: c.id,
              label: c.name,
              count: counts?.cluster?.[c.id] ?? 0,
            })),
          },
        ]
      : []),
    {
      id: 'tag',
      label: t('devices.tags'),
      options: valuesOf('tag')
        .sort()
        .map((v) => ({ value: v, label: v, count: counts?.tag?.[v] ?? 0 })),
    },
  ]

  const columns = useMemo<DataColumn<Device>[]>(
    () => [
      {
        id: 'hostname',
        accessorKey: 'hostname',
        header: t('devices.hostname'),
        meta: { label: t('devices.hostname'), width: 180, pin: true, alwaysVisible: true },
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
        meta: { label: t('devices.mgmtIp'), width: 160 },
        cell: ({ row }) =>
          row.original.mgmtIp ? (
            <TechText value={row.original.mgmtIp} label={t('devices.mgmtIp')} />
          ) : (
            <span className="text-muted-foreground">{t('common.none')}</span>
          ),
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: t('devices.type'),
        meta: { label: t('devices.type'), width: 130 },
        cell: ({ row }) => t(`devices.types.${row.original.type}`),
      },
      {
        id: 'vendor',
        accessorKey: 'vendor',
        header: t('devices.vendor'),
        meta: { label: t('devices.vendor'), width: 110 },
      },
      {
        id: 'model',
        accessorKey: 'model',
        header: t('devices.model'),
        meta: { label: t('devices.model'), width: 160 },
      },
      {
        id: 'serial',
        accessorKey: 'serialNumber',
        header: t('devices.serial'),
        meta: { label: t('devices.serial'), width: 150 },
        cell: ({ row }) =>
          row.original.serialNumber ? (
            <TechText value={row.original.serialNumber} label={t('devices.serial')} />
          ) : (
            <span className="text-muted-foreground">{t('common.none')}</span>
          ),
      },
      {
        id: 'category',
        accessorFn: (d) => d.categoryPath,
        header: t('sites.category'),
        meta: { label: t('sites.category'), width: 180 },
      },
      {
        id: 'site',
        accessorKey: 'siteCode',
        header: t('devices.placement'),
        meta: { label: t('devices.placement'), width: 300 },
        cell: ({ row: { original: d } }) => (
          <span>
            {d.siteCode}
            {(d.locationName || d.rackName) && (
              <span className="text-muted-foreground">
                {' '}
                ›{' '}
                {[d.locationName, d.rackName && `${d.rackName}${d.rackU ? ` U${d.rackU}` : ''}`]
                  .filter(Boolean)
                  .join(' › ')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'lifecycle',
        accessorKey: 'lifecycle',
        header: t('devices.lifecycle'),
        meta: { label: t('devices.lifecycle'), width: 150 },
        cell: ({ row }) => t(`devices.lifecycleValues.${row.original.lifecycle}`),
      },
      {
        id: 'warrantyEnd',
        accessorKey: 'warrantyEnd',
        header: t('devices.warranty'),
        meta: { label: t('devices.warranty'), width: 130 },
        cell: ({ row }) => <WarrantyText date={row.original.warrantyEnd} />,
      },
      {
        id: 'cluster',
        accessorKey: 'clusterName',
        header: t('clusters.cluster'),
        enableSorting: false,
        meta: { label: t('clusters.cluster'), width: 150 },
        cell: ({ row: { original: d } }) =>
          d.clusterId ? (
            <span>
              {d.clusterName}
              {d.clusterMemberNo && (
                <span className="text-muted-foreground"> #{d.clusterMemberNo}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('common.none')}</span>
          ),
      },
      {
        id: 'firmware',
        accessorKey: 'firmware',
        header: t('devices.firmware'),
        enableSorting: false,
        meta: { label: t('devices.firmware'), width: 150 },
      },
      {
        id: 'owner',
        accessorKey: 'ownerName',
        header: t('devices.owner'),
        enableSorting: false,
        meta: { label: t('devices.owner'), width: 150 },
      },
      {
        id: 'tags',
        accessorFn: (d) => d.tags.join(', '),
        header: t('devices.tags'),
        enableSorting: false,
        meta: { label: t('devices.tags'), width: 160 },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.more')}</span>,
        enableSorting: false,
        meta: { label: t('common.more'), width: 48, alwaysVisible: true, align: 'right' },
        cell: ({ row }) => (
          <RowActions
            device={row.original}
            onEdit={() => setEditing(row.original)}
            onDelete={() => setConfirmDelete([row.original])}
          />
        ),
      },
    ],
    [t],
  )

  const filtered = filter.q !== '' || Object.values(filter.facets).some((v) => v.length > 0)
  const doDelete = (devices: Device[]) =>
    del.mutate(
      devices.map((d) => d.id),
      {
        onSuccess: (n) => {
          toast.success(t('devices.deleted', { count: n }))
          setSelection({})
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => setConfirmDelete(null),
      },
    )

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('devices.title')}
        count={list.data?.total}
        actions={
          access.canAddSites && (
            <>
              <Button
                variant={tab === 'devices' ? 'default' : 'outline'}
                onClick={() => setEditing('new')}
              >
                <Plus aria-hidden /> {t('devices.add')}
              </Button>
              <Button
                variant={tab === 'groups' ? 'default' : 'outline'}
                onClick={() => setCreatingGroup(true)}
              >
                <Plus aria-hidden /> {t('endpoints.add')}
              </Button>
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'groups' ? { tab: 'groups' } : {}, { replace: true })}
      >
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="devices">{t('endpoints.tabDevices')}</TabsTrigger>
          <TabsTrigger value="groups">{t('endpoints.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="groups" className="pt-3">
          <EndpointGroupsTable
            orgId={orgId}
            canAdd={access.canAddSites}
            onAdd={() => setCreatingGroup(true)}
          />
        </TabsContent>
        <TabsContent value="devices" className="pt-3">
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
            defaultHidden={['vendor', 'firmware', 'owner', 'tags', 'category', 'cluster']}
            data={rows}
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
            maxHeight="calc(100vh - 280px)"
            empty={
              filtered ? (
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
              ) : (
                <EmptyState
                  icon={<Server />}
                  title={t('devices.noneTitle')}
                  description={t('devices.noneBody')}
                  action={
                    access.canAddSites && (
                      <Button onClick={() => setEditing('new')}>
                        <Plus aria-hidden /> {t('devices.add')}
                      </Button>
                    )
                  }
                />
              )
            }
            bulkActions={(ids) => (
              <>
                <Button variant="outline" size="sm" onClick={() => setBulkEdit(ids)}>
                  {t('devices.bulkEdit')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    setConfirmDelete(ids.map((id) => byId.get(id)).filter((d): d is Device => !!d))
                  }
                >
                  {t('devices.bulkDelete')}
                </Button>
              </>
            )}
          />
        </TabsContent>
      </Tabs>
      {creatingGroup && (
        <EndpointGroupDialog
          orgId={orgId}
          onClose={() => setCreatingGroup(false)}
          onSaved={(g) => navigate(`/o/${orgId}/endpoint-groups/${g.id}`)}
        />
      )}

      {editing && (
        <DeviceFormDialog
          orgId={orgId}
          device={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => editing === 'new' && navigate(d.id)}
        />
      )}
      {bulkEdit && (
        <BulkEditDialog orgId={orgId} ids={bulkEdit} onClose={() => setBulkEdit(null)} />
      )}
      <ConfirmDialog
        open={confirmDelete?.length === 1}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('devices.deleteTitle', { name: confirmDelete?.[0]?.hostname ?? '' })}
        description={t('devices.deleteBody')}
        confirmLabel={t('devices.delete')}
        pending={del.isPending}
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
      />
      <ConfirmDialog
        open={(confirmDelete?.length ?? 0) > 1}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('devices.bulkDeleteTitle', { count: confirmDelete?.length ?? 0 })}
        description={t('devices.bulkDeleteBody')}
        consequences={confirmDelete
          ?.slice(0, 5)
          .map((d) => d.hostname)
          .concat(
            confirmDelete.length > 5
              ? [t('devices.andMore', { count: confirmDelete.length - 5 })]
              : [],
          )}
        confirmText={t('devices.bulkDeleteConfirm', { count: confirmDelete?.length ?? 0 })}
        confirmLabel={t('devices.bulkDeleteConfirm', { count: confirmDelete?.length ?? 0 })}
        pending={del.isPending}
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
      />
    </div>
  )
}
