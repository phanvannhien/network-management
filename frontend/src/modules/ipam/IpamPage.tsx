import { Network, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
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
import { useLocalTable } from '@/components/localTable'
import { PageHeader } from '@/components/PageHeader'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { atLeast, useInScope, useOrgAccess } from '@/modules/sites/access'
import { useSites } from '@/modules/sites/sites'
import { SubnetDialog, VlanDialog } from './IpamDialogs'
import {
  nestings,
  useIpLookup,
  useIpamMutations,
  useSubnets,
  useVlans,
  usagePercent,
  type Subnet,
  type Vlan,
} from './ipam'
import { HolderLink, HolderRole, UsageBar, VlanChip } from './UsageBar'
import { IpamImportDialog } from './IpamImportDialog'
import { cn } from '@/lib/utils'
import { useHelpTopic } from '@/help/topic'

const TABS = ['subnets', 'vlans'] as const
type Tab = (typeof TABS)[number]
const ORG_WIDE = 'org'

/** Topbar category filter through the object's site; organization-wide objects pass only "all". */
function useSiteScope(orgId: string) {
  const sites = useSites(orgId)
  const passes = useInScope(orgId)
  const byId = useMemo(() => new Map((sites.data ?? []).map((s) => [s.id, s])), [sites.data])
  return (siteId: string | null) => passes(siteId ? byId.get(siteId)?.categoryId : undefined)
}

function siteFacet(
  label: string,
  orgWide: string,
  rows: { siteId: string | null; siteCode: string }[],
): Facet {
  const counts = new Map<string, { label: string; count: number }>()
  for (const r of rows) {
    const key = r.siteId ?? ORG_WIDE
    const c = counts.get(key) ?? { label: r.siteId ? r.siteCode : orgWide, count: 0 }
    c.count++
    counts.set(key, c)
  }
  return {
    id: 'site',
    label,
    options: [...counts].map(([value, c]) => ({ value, label: c.label, count: c.count })),
  }
}

function SiteCell({ code }: { code: string }) {
  const { t } = useTranslation()
  return code ? (
    <span>{code}</span>
  ) : (
    <span className="text-muted-foreground">{t('ipam.orgWide')}</span>
  )
}

function SubnetsTable({
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
  const subnets = useSubnets(orgId, '', '')
  const passes = useSiteScope(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const scoped = useMemo(
    () => subnets.data?.filter((s) => passes(s.siteId)),
    [subnets.data, passes],
  )
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const siteF = filter.facets.site ?? []
    const vrfF = filter.facets.vrf ?? []
    return scoped?.filter(
      (s) =>
        (!q ||
          [s.cidr, s.description, s.vlanName, s.gateway ?? ''].some((v) =>
            v.toLowerCase().includes(q),
          )) &&
        (siteF.length === 0 || siteF.includes(s.siteId ?? ORG_WIDE)) &&
        (vrfF.length === 0 || vrfF.includes(s.vrf)),
    )
  }, [scoped, filter])
  const table = useLocalTable(
    rows,
    {
      cidr: (s) => s.cidr,
      vrf: (s) => s.vrf,
      site: (s) => s.siteCode || '~',
      vlan: (s) => s.vlanVid ?? 99999,
      usage: (s) => usagePercent(s.usedCount, s.size),
    },
    [],
  )
  // Nested subnets of one VRF (P2-09): a warning inside a subnet in use, a note inside a plan block.
  const nested = useMemo(() => nestings(subnets.data ?? []), [subnets.data])
  const vrfs = [...new Set((scoped ?? []).map((s) => s.vrf))]
  const facets: Facet[] = [
    siteFacet(t('ipam.site'), t('ipam.orgWide'), scoped ?? []),
    ...(vrfs.length > 1
      ? [
          {
            id: 'vrf',
            label: t('ipam.vrf'),
            options: vrfs.map((v) => ({
              value: v,
              label: v || t('common.none'),
              count: (scoped ?? []).filter((s) => s.vrf === v).length,
            })),
          },
        ]
      : []),
  ]
  const columns: DataColumn<Subnet>[] = [
    {
      id: 'cidr',
      accessorKey: 'cidr',
      header: t('ipam.cidr'),
      meta: { label: t('ipam.cidr'), width: 180, pin: true, alwaysVisible: true },
      cell: ({ row: { original: s } }) => {
        const n = nested.get(s.id)
        return (
          <span className="flex items-center gap-1">
            <Link
              to={`/o/${orgId}/ipam/subnets/${s.id}`}
              className="font-mono text-tech font-medium hover:text-primary hover:underline"
            >
              {s.cidr}
            </Link>
            {n && (
              <span
                className={cn('text-xs', n.inUse ? 'text-status-warning' : 'text-muted-foreground')}
                title={t(n.inUse ? 'ipam.overlapHint' : 'ipam.insideHint', {
                  parent: n.parentCidr,
                })}
              >
                {n.inUse ? `⚠ ${t('ipam.overlap', { parent: n.parentCidr })}` : `⊂ ${n.parentCidr}`}
              </span>
            )}
          </span>
        )
      },
    },
    {
      id: 'vrf',
      accessorKey: 'vrf',
      header: t('ipam.vrf'),
      meta: { label: t('ipam.vrf'), width: 100 },
      cell: ({ row }) =>
        row.original.vrf || <span className="text-muted-foreground">{t('common.none')}</span>,
    },
    {
      id: 'vlan',
      header: t('ipam.vlan'),
      meta: { label: t('ipam.vlan'), width: 170 },
      cell: ({ row: { original: s } }) => (
        <VlanChip vid={s.vlanVid} name={s.vlanName} color={s.vlanColor} />
      ),
    },
    {
      id: 'site',
      header: t('ipam.site'),
      meta: { label: t('ipam.site'), width: 140 },
      cell: ({ row }) => <SiteCell code={row.original.siteCode} />,
    },
    {
      id: 'gateway',
      header: t('ipam.gateway'),
      enableSorting: false,
      meta: { label: t('ipam.gateway'), width: 140 },
      cell: ({ row }) =>
        row.original.gateway ? (
          <TechText value={row.original.gateway} label={t('ipam.gateway')} />
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'usage',
      header: t('ipam.usage'),
      meta: { label: t('ipam.usage'), width: 280 },
      cell: ({ row: { original: s } }) => (
        <UsageBar used={s.usedCount} size={s.size} label={`${t('ipam.usage')} ${s.cidr}`} />
      ),
    },
    {
      id: 'ranges',
      accessorKey: 'rangeCount',
      header: t('ipam.ranges'),
      enableSorting: false,
      meta: { label: t('ipam.ranges'), width: 80, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.rangeCount}</span>,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t('ipam.description'),
      enableSorting: false,
      meta: { label: t('ipam.description'), width: 260 },
    },
  ]
  return (
    <DataTable
      tableId="subnets"
      userId={userId}
      caption={t('ipam.tabSubnets')}
      columns={columns}
      data={table.data}
      total={table.total}
      isLoading={subnets.isPending}
      error={subnets.error}
      getRowId={(s) => s.id}
      rowLabel={(s) => s.cidr}
      pagination={table.pagination}
      onPaginationChange={table.onPaginationChange}
      sorting={table.sorting}
      onSortingChange={table.onSortingChange}
      maxHeight="calc(100vh - 340px)"
      filters={
        <FilterBar
          value={filter}
          onChange={(f) => {
            setFilter(f)
            table.resetPage()
          }}
          facets={facets}
          searchPlaceholder={t('ipam.searchSubnets')}
          storageKey={`ntb-filters:${userId}:subnets`}
        />
      }
      empty={
        <EmptyState
          icon={<Network />}
          title={t('ipam.emptySubnets')}
          description={t('ipam.emptySubnetsBody')}
          action={
            canAdd && (
              <Button onClick={onAdd}>
                <Plus aria-hidden /> {t('ipam.addSubnet')}
              </Button>
            )
          }
        />
      }
    />
  )
}

function VlansTable({
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
  const vlans = useVlans(orgId)
  const { removeVlan } = useIpamMutations(orgId)
  const passes = useSiteScope(orgId)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [editing, setEditing] = useState<Vlan | null>(null)
  const [deleting, setDeleting] = useState<Vlan | null>(null)
  const scoped = useMemo(() => vlans.data?.filter((v) => passes(v.siteId)), [vlans.data, passes])
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const siteF = filter.facets.site ?? []
    return scoped?.filter(
      (v) =>
        (!q ||
          String(v.vid) === q ||
          v.name.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q)) &&
        (siteF.length === 0 || siteF.includes(v.siteId ?? ORG_WIDE)),
    )
  }, [scoped, filter])
  const table = useLocalTable(
    rows,
    {
      vid: (v) => v.vid,
      name: (v) => v.name,
      site: (v) => v.siteCode || '~',
      subnets: (v) => v.subnetCount,
    },
    [],
  )
  const columns: DataColumn<Vlan>[] = [
    {
      id: 'vid',
      accessorKey: 'vid',
      header: t('ipam.vid'),
      meta: { label: t('ipam.vid'), width: 100, pin: true, alwaysVisible: true },
      cell: ({ row: { original: v } }) => <VlanChip vid={v.vid} color={v.color} />,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('ipam.vlanName'),
      meta: { label: t('ipam.vlanName'), width: 200 },
    },
    {
      id: 'site',
      header: t('ipam.site'),
      meta: { label: t('ipam.site'), width: 140 },
      cell: ({ row }) => <SiteCell code={row.original.siteCode} />,
    },
    {
      id: 'subnets',
      accessorKey: 'subnetCount',
      header: t('ipam.subnetCount'),
      meta: { label: t('ipam.subnetCount'), width: 100, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.subnetCount}</span>,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t('ipam.description'),
      enableSorting: false,
      meta: { label: t('ipam.description'), width: 280 },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { label: t('table.actions'), width: 90, alwaysVisible: true },
      cell: ({ row: { original: v } }) =>
        atLeast(v.access, 'edit') && (
          <span className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t('ipam.editVlan')} ${v.vid}`}
              onClick={() => setEditing(v)}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t('ipam.deleteVlan')} ${v.vid}`}
              onClick={() => setDeleting(v)}
            >
              <Trash2 aria-hidden />
            </Button>
          </span>
        ),
    },
  ]
  return (
    <>
      <DataTable
        tableId="vlans"
        userId={userId}
        caption={t('ipam.tabVlans')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={vlans.isPending}
        error={vlans.error}
        getRowId={(v) => v.id}
        rowLabel={(v) => `VLAN ${v.vid}`}
        pagination={table.pagination}
        onPaginationChange={table.onPaginationChange}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        maxHeight="calc(100vh - 340px)"
        filters={
          <FilterBar
            value={filter}
            onChange={(f) => {
              setFilter(f)
              table.resetPage()
            }}
            facets={[siteFacet(t('ipam.site'), t('ipam.orgWide'), scoped ?? [])]}
            searchPlaceholder={t('ipam.searchVlans')}
            storageKey={`ntb-filters:${userId}:vlans`}
          />
        }
        empty={
          <EmptyState
            icon={<Network />}
            title={t('ipam.emptyVlans')}
            description={t('ipam.emptyVlansBody')}
            action={
              canAdd && (
                <Button onClick={onAdd}>
                  <Plus aria-hidden /> {t('ipam.addVlan')}
                </Button>
              )
            }
          />
        }
      />
      {editing && <VlanDialog orgId={orgId} vlan={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('ipam.deleteVlanTitle', {
          name: deleting ? `${deleting.vid} ${deleting.name}` : '',
        })}
        description={t('ipam.deleteVlanBody')}
        confirmLabel={t('ipam.deleteVlan')}
        pending={removeVlan.isPending}
        onConfirm={() =>
          deleting &&
          removeVlan.mutate(deleting.id, {
            onSuccess: () => toast.success(t('ipam.deleted')),
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </>
  )
}

/** "Who has this IP": containing subnets and interface assignments; others' devices only counted. */
function IpLookupPanel({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const ip = params.get('ip') ?? ''
  const [input, setInput] = useState(ip)
  const lookup = useIpLookup(orgId, ip)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(params)
    if (input.trim()) next.set('ip', input.trim())
    else next.delete('ip')
    setParams(next, { replace: true })
  }
  return (
    <section
      aria-label={t('ipam.lookup')}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <form onSubmit={onSubmit} className="flex items-center gap-2" role="search">
        <label htmlFor="ip-lookup" className="font-medium whitespace-nowrap">
          {t('ipam.lookup')}
        </label>
        <Input
          id="ip-lookup"
          aria-label={t('ipam.lookupLabel')}
          placeholder={t('ipam.lookupPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="max-w-xs font-mono"
        />
        <Button type="submit" variant="outline">
          <Search aria-hidden /> {t('ipam.lookupButton')}
        </Button>
      </form>
      {ip &&
        (lookup.isPending ? (
          <Skeleton className="h-10" />
        ) : lookup.isError ? (
          <p role="alert" className="text-destructive">
            {lookup.error.message}
          </p>
        ) : (
          <div aria-live="polite" className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <h2 className="font-medium text-muted-foreground">{t('ipam.lookupSubnets')}</h2>
              {lookup.data.subnets.length === 0 ? (
                <p className="text-muted-foreground">{t('ipam.lookupNoSubnet')}</p>
              ) : (
                <ul className="space-y-1">
                  {lookup.data.subnets.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                      <Link
                        to={`/o/${orgId}/ipam/subnets/${s.id}`}
                        className="font-mono text-tech hover:text-primary hover:underline"
                      >
                        {s.cidr}
                      </Link>
                      {s.vrf && <span className="text-muted-foreground">VRF {s.vrf}</span>}
                      <VlanChip vid={s.vlanVid} name={s.vlanName} color={s.vlanColor} />
                      <SiteCell code={s.siteCode} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <h2 className="font-medium text-muted-foreground">{t('ipam.lookupAssigned')}</h2>
              {lookup.data.assignments.length === 0 && lookup.data.hiddenCount === 0 && (
                <p className="text-muted-foreground">
                  {t('ipam.lookupFree', { ip: lookup.data.ip })}
                </p>
              )}
              <ul className="space-y-1">
                {lookup.data.assignments.map((a) => (
                  <li
                    key={`${a.deviceId ?? a.clusterId}-${a.interfaceName}-${a.address}`}
                    className="flex flex-wrap gap-x-2"
                  >
                    <HolderLink orgId={orgId} ip={a} />
                    {a.interfaceName && (
                      <span className="font-mono text-tech">{a.interfaceName}</span>
                    )}
                    <span className="font-mono text-tech text-muted-foreground">{a.address}</span>
                    <span className="text-muted-foreground">
                      <HolderRole ip={a} />
                      {a.vrf && ` · VRF ${a.vrf}`}
                    </span>
                  </li>
                ))}
              </ul>
              {lookup.data.hiddenCount > 0 && (
                <p className="text-muted-foreground">
                  {t('ipam.hiddenAssignments', { count: lookup.data.hiddenCount })}
                </p>
              )}
            </div>
          </div>
        ))}
    </section>
  )
}

/** IPAM (P1-10, SRS §5): subnets with usage, VLANs, and the IP lookup. */
export function IpamPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const access = useOrgAccess(orgId)
  const [creating, setCreating] = useState<Tab | null>(null)
  const tab: Tab = TABS.find((x) => x === params.get('tab')) ?? 'subnets'
  // Anyone who edits some site may add subnets/VLANs there; organization-wide ones need an org role.
  const canAdd = access.canAddSites
  const [importing, setImporting] = useState(false)
  useBreadcrumbs([{ label: t('ipam.title') }])
  useHelpTopic('ipam')
  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('ipam.title')}
        description={t('ipam.subtitle')}
        actions={
          canAdd && (
            <>
              <Button
                variant={tab === 'subnets' ? 'default' : 'outline'}
                onClick={() => setCreating('subnets')}
              >
                <Plus aria-hidden /> {t('ipam.addSubnet')}
              </Button>
              <Button
                variant={tab === 'vlans' ? 'default' : 'outline'}
                onClick={() => setCreating('vlans')}
              >
                <Plus aria-hidden /> {t('ipam.addVlan')}
              </Button>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload aria-hidden /> {t('ipamImport.open')}
              </Button>
            </>
          )
        }
      />
      {importing && <IpamImportDialog orgId={orgId} onClose={() => setImporting(false)} />}
      <IpLookupPanel orgId={orgId} />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params)
          next.set('tab', String(v))
          setParams(next, { replace: true })
        }}
      >
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="subnets">{t('ipam.tabSubnets')}</TabsTrigger>
          <TabsTrigger value="vlans">{t('ipam.tabVlans')}</TabsTrigger>
        </TabsList>
        <TabsContent value="subnets" className="pt-3">
          <SubnetsTable orgId={orgId} canAdd={canAdd} onAdd={() => setCreating('subnets')} />
        </TabsContent>
        <TabsContent value="vlans" className="pt-3">
          <VlansTable orgId={orgId} canAdd={canAdd} onAdd={() => setCreating('vlans')} />
        </TabsContent>
      </Tabs>
      {creating === 'subnets' && (
        <SubnetDialog
          orgId={orgId}
          onClose={() => setCreating(null)}
          onSaved={(s) => navigate(`/o/${orgId}/ipam/subnets/${s.id}`)}
        />
      )}
      {creating === 'vlans' && <VlanDialog orgId={orgId} onClose={() => setCreating(null)} />}
    </div>
  )
}
