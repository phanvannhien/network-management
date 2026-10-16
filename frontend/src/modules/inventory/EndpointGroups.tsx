import { ArrowUpRight, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar, type Facet } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { FormField } from '@/components/FormField'
import { KeyValueList } from '@/components/KeyValueList'
import { useLocalTable } from '@/components/localTable'
import { NativeSelect } from '@/components/NativeSelect'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useSubnet, useSubnets } from '@/modules/ipam/ipam'
import { UsageBar } from '@/modules/ipam/UsageBar'
import { atLeast, inScope, useScope } from '@/modules/sites/access'
import { useBusinessUnits, useSites } from '@/modules/sites/sites'
import { useDeviceList, useInterfaces } from './devices'
import { LinksPanel } from './LinksPanel'
import {
  ENDPOINT_KINDS,
  useEndpointGroup,
  useEndpointGroups,
  useEndpointMutations,
  type EndpointGroup,
  type EndpointGroupDetail,
  type EndpointKind,
  type EndpointMember,
} from './endpoints'

const PORT_DEVICE_TYPES = [
  'poe_switch',
  'l2_switch',
  'l3_switch',
  'access_point',
  'router',
  'firewall',
  'media_converter',
  'sdwan_edge',
]

function rangeText(g: EndpointGroup): string {
  return g.rangeStart && g.rangeEnd ? `${g.rangeStart} – ${g.rangeEnd}` : ''
}

/** Endpoint groups list (tab of the device page). */
export function EndpointGroupsTable({
  orgId,
  canAdd,
  onAdd,
}: {
  orgId: string
  canAdd: boolean
  onAdd: () => void
}) {
  const { t } = useTranslation()
  const userId = useSession().data?.user.id ?? ''
  const groups = useEndpointGroups(orgId)
  const sites = useSites(orgId)
  const scope = useScope(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const scoped = useMemo(() => {
    const byId = new Map((sites.data ?? []).map((s) => [s.id, s]))
    return groups.data?.filter((g) => {
      const s = byId.get(g.siteId)
      return inScope(scope, { partnerId: s?.partnerId ?? null, unitId: g.businessUnitId })
    })
  }, [groups.data, sites.data, scope])
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const siteF = filter.facets.site ?? []
    const kindF = filter.facets.kind ?? []
    return scoped?.filter(
      (g) =>
        (!q || [g.name, g.notes, rangeText(g)].some((v) => v.toLowerCase().includes(q))) &&
        (siteF.length === 0 || siteF.includes(g.siteId)) &&
        (kindF.length === 0 || kindF.includes(g.kind)),
    )
  }, [scoped, filter])
  const table = useLocalTable(
    rows,
    {
      name: (g) => g.name,
      kind: (g) => g.kind,
      site: (g) => g.siteCode,
      used: (g) => (g.total ? g.memberCount / g.total : 0),
    },
    [{ id: 'name', desc: false }],
  )
  const count = (pred: (g: EndpointGroup) => boolean) => (scoped ?? []).filter(pred).length
  const facets: Facet[] = [
    {
      id: 'site',
      label: t('devices.site'),
      options: [...new Map((scoped ?? []).map((g) => [g.siteId, g.siteCode]))].map(
        ([value, label]) => ({
          value,
          label,
          count: count((g) => g.siteId === value),
        }),
      ),
    },
    {
      id: 'kind',
      label: t('endpoints.kind'),
      options: ENDPOINT_KINDS.filter((k) => count((g) => g.kind === k) > 0).map((k) => ({
        value: k,
        label: t(`devices.types.${k}`),
        count: count((g) => g.kind === k),
      })),
    },
  ]
  const columns: DataColumn<EndpointGroup>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t('endpoints.name'),
      meta: { label: t('endpoints.name'), width: 220, pin: true, alwaysVisible: true },
      cell: ({ row: { original: g } }) => (
        <Link
          to={`/o/${orgId}/endpoint-groups/${g.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {g.name}
        </Link>
      ),
    },
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t('endpoints.kind'),
      meta: { label: t('endpoints.kind'), width: 150 },
      cell: ({ row }) => t(`devices.types.${row.original.kind}`),
    },
    {
      id: 'site',
      accessorKey: 'siteCode',
      header: t('devices.site'),
      meta: { label: t('devices.site'), width: 130 },
    },
    {
      id: 'range',
      header: t('endpoints.range'),
      enableSorting: false,
      meta: { label: t('endpoints.range'), width: 240 },
      cell: ({ row: { original: g } }) =>
        g.rangeStart ? (
          <span className="font-mono text-tech">{rangeText(g)}</span>
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'used',
      header: t('endpoints.used'),
      meta: { label: t('endpoints.used'), width: 230 },
      cell: ({ row: { original: g } }) => (
        <UsageBar used={g.memberCount} size={g.total} label={`${t('endpoints.used')} ${g.name}`} />
      ),
    },
    {
      id: 'notes',
      accessorKey: 'notes',
      header: t('endpoints.notes'),
      enableSorting: false,
      meta: { label: t('endpoints.notes'), width: 260 },
    },
  ]
  return (
    <DataTable
      tableId="endpoint-groups"
      userId={userId}
      caption={t('endpoints.title')}
      columns={columns}
      data={table.data}
      total={table.total}
      isLoading={groups.isPending}
      error={groups.error}
      getRowId={(g) => g.id}
      rowLabel={(g) => g.name}
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
          searchPlaceholder={t('endpoints.search')}
          storageKey={`ntb-filters:${userId}:endpoint-groups`}
        />
      }
      empty={
        <EmptyState
          icon={<Users />}
          title={t('endpoints.emptyTitle')}
          description={t('endpoints.emptyBody')}
          action={
            canAdd && (
              <Button onClick={onAdd}>
                <Plus aria-hidden /> {t('endpoints.add')}
              </Button>
            )
          }
        />
      }
    />
  )
}

function FormDialog({
  title,
  error,
  pending,
  onSubmit,
  onClose,
  children,
  wide,
}: {
  title: string
  error?: string
  pending: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'max-h-[90vh] overflow-y-auto sm:max-w-2xl' : 'sm:max-w-lg'}>
        <form
          aria-label={title}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EndpointGroupDialog({
  orgId,
  group,
  onClose,
  onSaved,
}: {
  orgId: string
  group?: EndpointGroup
  onClose: () => void
  onSaved?: (g: EndpointGroupDetail) => void
}) {
  const { t } = useTranslation()
  const { saveGroup } = useEndpointMutations(orgId)
  const sites = useSites(orgId)
  const units = useBusinessUnits(orgId)
  const subnets = useSubnets(orgId, '', '')
  const [f, setF] = useState({
    kind: (group?.kind ?? 'ip_camera') as EndpointKind,
    name: group?.name ?? '',
    siteId: group?.siteId ?? '',
    businessUnitId: group?.businessUnitId ?? '',
    subnetId: group?.subnetId ?? '',
    ipRangeId: group?.ipRangeId ?? '',
    expectedCount: group?.expectedCount != null ? String(group.expectedCount) : '',
    notes: group?.notes ?? '',
  })
  const subnet = useSubnet(orgId, f.subnetId)
  const site = sites.data?.find((s) => s.id === f.siteId)
  const shared = site !== undefined && site.businessUnitId === null
  const siteOptions = (sites.data ?? []).filter(
    (s) => atLeast(s.access, 'edit') || s.id === group?.siteId,
  )
  const ownerUnits = (units.data ?? []).filter(
    (u) => atLeast(u.access, 'edit') || u.id === group?.businessUnitId,
  )
  // The group's site's subnets and the organization-wide ones (the server checks the same).
  const subnetOptions = (subnets.data ?? []).filter(
    (s) => s.siteId === null || s.siteId === f.siteId,
  )
  const title = group ? t('endpoints.edit') : t('endpoints.add')
  return (
    <FormDialog
      title={title}
      wide
      pending={saveGroup.isPending}
      error={saveGroup.error?.message}
      onClose={onClose}
      onSubmit={() =>
        saveGroup.mutate(
          {
            group,
            body: {
              kind: f.kind,
              name: f.name.trim(),
              siteId: f.siteId,
              businessUnitId: shared ? f.businessUnitId || null : null,
              ipRangeId: f.ipRangeId || null,
              expectedCount: f.expectedCount === '' ? null : Number(f.expectedCount),
              notes: f.notes,
            },
          },
          {
            onSuccess: (saved) => {
              toast.success(t('endpoints.saved'))
              onSaved?.(saved)
              onClose()
            },
          },
        )
      }
    >
      <p className="text-muted-foreground">{t('guides.endpointGroup')}</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('endpoints.name')} required hint={t('endpoints.nameHint')}>
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              maxLength={100}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </FormField>
        <FormField label={t('endpoints.kind')} guide={t('guides.endpointKind')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as EndpointKind })}
            >
              {ENDPOINT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`devices.types.${k}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('devices.site')} required help="site">
          {(p) => (
            <NativeSelect
              {...p}
              required
              value={f.siteId}
              onChange={(e) =>
                setF({
                  ...f,
                  siteId: e.target.value,
                  businessUnitId: '',
                  subnetId: '',
                  ipRangeId: '',
                })
              }
            >
              <option value="">{t('devices.chooseSite')}</option>
              {siteOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {shared ? (
          <FormField
            label={t('devices.unit')}
            required
            hint={t('devices.sharedSiteUnit')}
            help="partner-unit"
          >
            {(p) => (
              <NativeSelect
                {...p}
                required
                value={f.businessUnitId}
                onChange={(e) => setF({ ...f, businessUnitId: e.target.value })}
              >
                <option value="">{t('devices.chooseUnit')}</option>
                {ownerUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.partnerCode} › {u.code} · {u.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : (
          <FormField label={t('endpoints.expected')} guide={t('guides.endpointExpected')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100000}
                value={f.expectedCount}
                onChange={(e) => setF({ ...f, expectedCount: e.target.value })}
              />
            )}
          </FormField>
        )}
        <FormField label={t('endpoints.subnet')} help="subnet" guide={t('guides.endpointRange')}>
          {(p) => (
            <NativeSelect
              {...p}
              disabled={!f.siteId}
              value={f.subnetId}
              onChange={(e) => setF({ ...f, subnetId: e.target.value, ipRangeId: '' })}
            >
              <option value="">{t('endpoints.noRange')}</option>
              {subnetOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.cidr}
                  {s.description ? ` · ${s.description}` : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('endpoints.range')} help="ip-range">
          {(p) => (
            <NativeSelect
              {...p}
              disabled={!f.subnetId}
              required={f.subnetId !== ''}
              value={f.ipRangeId}
              onChange={(e) => setF({ ...f, ipRangeId: e.target.value })}
            >
              <option value="">{t('endpoints.chooseRange')}</option>
              {(subnet.data?.ranges ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.startIp} – {r.endIp} · {t(`ipam.rangeKinds.${r.kind}`)}
                  {r.purpose ? ` · ${r.purpose}` : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {shared && (
          <FormField label={t('endpoints.expected')} guide={t('guides.endpointExpected')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100000}
                value={f.expectedCount}
                onChange={(e) => setF({ ...f, expectedCount: e.target.value })}
              />
            )}
          </FormField>
        )}
      </div>
      <FormField label={t('endpoints.notes')}>
        {(p) => (
          <Textarea
            {...p}
            maxLength={2000}
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        )}
      </FormField>
    </FormDialog>
  )
}

function MemberDialog({
  orgId,
  group,
  member,
  onClose,
}: {
  orgId: string
  group: EndpointGroupDetail
  member?: EndpointMember
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { saveMember } = useEndpointMutations(orgId)
  const [f, setF] = useState({
    name: member?.name ?? '',
    ip: member?.ip ?? '',
    mac: member?.mac ?? '',
    switchId: member?.portDeviceId ?? '',
    interfaceId: member?.interfaceId ?? '',
    notes: member?.notes ?? '',
  })
  const switches = useDeviceList(orgId, {
    q: '',
    // Devices end devices plug into (switches first; an AP or firewall port also counts).
    facets: { site: [group.siteId], type: PORT_DEVICE_TYPES },
    partnerId: null,
    unitId: null,
    sort: { id: 'hostname', desc: false },
    pageIndex: 0,
    pageSize: 200,
  })
  const ports = useInterfaces(orgId, f.switchId, f.switchId !== '')
  const title = member ? t('endpoints.memberEdit') : t('endpoints.memberAdd')
  return (
    <FormDialog
      title={title}
      pending={saveMember.isPending}
      error={saveMember.error?.message}
      onClose={onClose}
      onSubmit={() =>
        saveMember.mutate(
          {
            groupId: group.id,
            member,
            body: {
              name: f.name.trim(),
              ip: f.ip.trim() || null,
              mac: f.mac.trim() || null,
              interfaceId: f.interfaceId || null,
              notes: f.notes,
            },
          },
          {
            onSuccess: () => {
              toast.success(t('endpoints.saved'))
              onClose()
            },
          },
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t('endpoints.memberName')}
          required
          hint={t('endpoints.memberNameHint')}
          className="col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              maxLength={100}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </FormField>
        <FormField
          label={t('endpoints.ip')}
          help="ip"
          hint={
            group.rangeStart
              ? t('endpoints.ipInRange', { range: rangeText(group) })
              : t('endpoints.ipOptional')
          }
        >
          {(p) => (
            <Input
              {...p}
              placeholder={group.rangeStart ?? '10.72.120.15'}
              value={f.ip}
              onChange={(e) => setF({ ...f, ip: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label="MAC" help="mac" guide={t('hints.mac')}>
          {(p) => (
            <Input
              {...p}
              value={f.mac}
              onChange={(e) => setF({ ...f, mac: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label={t('endpoints.switch')} guide={t('guides.endpointPort')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={f.switchId}
              onChange={(e) => setF({ ...f, switchId: e.target.value, interfaceId: '' })}
            >
              <option value="">{t('endpoints.noPort')}</option>
              {(switches.data?.devices ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('endpoints.port')} help="interface">
          {(p) => (
            <NativeSelect
              {...p}
              disabled={!f.switchId}
              required={f.switchId !== ''}
              value={f.interfaceId}
              onChange={(e) => setF({ ...f, interfaceId: e.target.value })}
            >
              <option value="">{t('endpoints.choosePort')}</option>
              {(ports.data ?? [])
                .filter((i) => i.kind === 'physical')
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField label={t('endpoints.notes')}>
        {(p) => (
          <Input
            {...p}
            maxLength={500}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        )}
      </FormField>
    </FormDialog>
  )
}

function PromoteDialog({
  orgId,
  group,
  member,
  onClose,
}: {
  orgId: string
  group: EndpointGroupDetail
  member: EndpointMember
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { promote } = useEndpointMutations(orgId)
  const [hostname, setHostname] = useState(member.name.replace(/\s+/g, '-'))
  return (
    <FormDialog
      title={t('endpoints.promoteTitle', { name: member.name })}
      pending={promote.isPending}
      error={promote.error?.message}
      onClose={onClose}
      onSubmit={() =>
        promote.mutate(
          { groupId: group.id, memberId: member.id, hostname: hostname.trim() },
          {
            onSuccess: (d) => {
              toast.success(t('endpoints.promoted', { hostname: d.hostname }))
              navigate(`/o/${orgId}/devices/${d.id}`)
            },
          },
        )
      }
    >
      <p className="text-muted-foreground">
        {t('endpoints.promoteBody', {
          type: t(`devices.types.${group.kind}`),
          site: group.siteCode,
        })}
      </p>
      <FormField
        label={t('devices.hostname')}
        required
        help="hostname"
        guide={t('guides.hostname')}
      >
        {(p) => (
          <Input
            {...p}
            required
            autoFocus
            maxLength={253}
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            className="font-mono"
          />
        )}
      </FormField>
    </FormDialog>
  )
}

/** One endpoint group (P1-11): planned range, members with IP / MAC / switch port, promote to device. */
export function EndpointGroupPage() {
  const { t } = useTranslation()
  const { orgId = '', groupId = '' } = useParams()
  const navigate = useNavigate()
  const group = useEndpointGroup(orgId, groupId)
  const { removeGroup, removeMember } = useEndpointMutations(orgId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [member, setMember] = useState<EndpointMember | 'new' | null>(null)
  const [promoting, setPromoting] = useState<EndpointMember | null>(null)
  const [removing, setRemoving] = useState<EndpointMember | null>(null)
  const g = group.data
  useBreadcrumbs([
    { label: t('nav.devices'), to: `/o/${orgId}/devices` },
    { label: t('endpoints.title'), to: `/o/${orgId}/devices?tab=groups` },
    { label: g?.name ?? '…' },
  ])
  if (group.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!g) return <NotFoundPage inShell />
  const canEdit = atLeast(g.access, 'edit')
  return (
    <div className="max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <Users aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-title font-semibold">{g.name}</h1>
            <p className="text-muted-foreground">
              {t(`devices.types.${g.kind}`)} · {g.siteCode} · {g.partnerCode} › {g.unitCode}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {t('endpoints.edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label={t('common.more')} />}
              >
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                  {t('endpoints.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <KeyValueList
          wrap
          items={[
            {
              label: t('endpoints.range'),
              value: g.rangeStart ? (
                <span className="font-mono text-tech">
                  {rangeText(g)}
                  {g.rangeKind && (
                    <span className="ml-2 font-sans text-muted-foreground">
                      {t(`ipam.rangeKinds.${g.rangeKind as 'dhcp'}`)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              ),
            },
            {
              label: t('endpoints.subnet'),
              value: g.subnetId ? (
                <Link
                  to={`/o/${orgId}/ipam/subnets/${g.subnetId}`}
                  className="font-mono text-tech hover:text-primary hover:underline"
                >
                  {g.subnetCidr}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              ),
            },
            {
              label: t('endpoints.expected'),
              value: g.expectedCount ?? (
                <span className="text-muted-foreground">{t('common.none')}</span>
              ),
            },
            {
              label: 'VRF',
              value: g.vrf || <span className="text-muted-foreground">{t('common.none')}</span>,
            },
          ]}
        />
        <div className="flex items-center gap-6">
          <span className="w-28 shrink-0 text-muted-foreground">{t('endpoints.used')}</span>
          <UsageBar
            used={g.memberCount}
            size={g.total}
            label={`${t('endpoints.used')} ${g.name}`}
            barClassName="w-64"
          />
        </div>
        {g.notes && <p className="whitespace-pre-line text-muted-foreground">{g.notes}</p>}
      </div>
      <section aria-labelledby="members" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="members" className="font-semibold">
            {t('endpoints.members')}
          </h2>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setMember('new')}>
              <Plus aria-hidden /> {t('endpoints.memberAdd')}
            </Button>
          )}
        </div>
        {g.members.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-3 text-muted-foreground">
            {t('endpoints.noMembers')}
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('endpoints.memberName')}</TableHead>
                  <TableHead>{t('endpoints.ip')}</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>{t('endpoints.port')}</TableHead>
                  <TableHead>{t('endpoints.notes')}</TableHead>
                  {canEdit && <TableHead className="w-32">{t('table.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.members.map((mb) => (
                  <TableRow key={mb.id}>
                    <TableCell className="font-medium">{mb.name}</TableCell>
                    <TableCell>
                      {mb.address ? (
                        <TechText value={mb.address} label={t('endpoints.ip')} />
                      ) : (
                        <span className="text-muted-foreground">{t('common.none')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mb.mac ? (
                        <TechText value={mb.mac} label="MAC" />
                      ) : (
                        <span className="text-muted-foreground">{t('common.none')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mb.portDeviceId ? (
                        <span>
                          <Link
                            to={`/o/${orgId}/devices/${mb.portDeviceId}`}
                            className="hover:text-primary hover:underline"
                          >
                            {mb.portHostname}
                          </Link>{' '}
                          <span className="font-mono text-tech">{mb.interfaceName}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('common.none')}</span>
                      )}
                    </TableCell>
                    <TableCell>{mb.notes}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <span className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('endpoints.promote')} ${mb.name}`}
                            title={t('endpoints.promote')}
                            onClick={() => setPromoting(mb)}
                          >
                            <ArrowUpRight aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('endpoints.memberEdit')} ${mb.name}`}
                            onClick={() => setMember(mb)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('endpoints.memberDelete')} ${mb.name}`}
                            onClick={() => setRemoving(mb)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-muted-foreground">{t('endpoints.promoteHint')}</p>
      </section>
      <section aria-labelledby="group-links" className="space-y-2">
        <h2 id="group-links" className="font-semibold">
          {t('links.title')}
        </h2>
        <LinksPanel
          orgId={orgId}
          owner={{ kind: 'endpoint_group', id: g.id, siteId: g.siteId }}
          canEdit={canEdit}
        />
      </section>
      {editing && <EndpointGroupDialog orgId={orgId} group={g} onClose={() => setEditing(false)} />}
      {member && (
        <MemberDialog
          orgId={orgId}
          group={g}
          member={member === 'new' ? undefined : member}
          onClose={() => setMember(null)}
        />
      )}
      {promoting && (
        <PromoteDialog
          orgId={orgId}
          group={g}
          member={promoting}
          onClose={() => setPromoting(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('endpoints.memberDeleteTitle', { name: removing?.name ?? '' })}
        confirmLabel={t('endpoints.memberDelete')}
        pending={removeMember.isPending}
        onConfirm={() =>
          removing &&
          removeMember.mutate(
            { groupId: g.id, memberId: removing.id },
            {
              onSettled: () => setRemoving(null),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('endpoints.deleteTitle', { name: g.name })}
        description={t('endpoints.deleteBody', { count: g.memberCount })}
        confirmLabel={t('endpoints.delete')}
        pending={removeGroup.isPending}
        onConfirm={() =>
          removeGroup.mutate(g.id, {
            onSuccess: () => {
              toast.success(t('endpoints.deleted'))
              navigate(`/o/${orgId}/devices?tab=groups`)
            },
            onSettled: () => setDeleting(false),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
