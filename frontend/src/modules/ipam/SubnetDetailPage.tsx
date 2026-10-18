import { MoreHorizontal, Network, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KeyValueList } from '@/components/KeyValueList'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { atLeast } from '@/modules/sites/access'
import { RangeDialog, SubnetDialog } from './IpamDialogs'
import {
  poolWarnings,
  fetchNextFree,
  formatSize,
  useIpamMutations,
  useSubnet,
  type IpRange,
  type SubnetDetail,
} from './ipam'
import { HolderLink, HolderRole, UsageBar, VlanChip } from './UsageBar'

function NextFree({ orgId, subnetId }: { orgId: string; subnetId: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; address: string | null }
  >({ kind: 'idle' })
  const find = () => {
    setState({ kind: 'busy' })
    fetchNextFree(orgId, subnetId).then(
      (address) => setState({ kind: 'done', address }),
      (e: Error) => {
        toast.error(e.message)
        setState({ kind: 'idle' })
      },
    )
  }
  return (
    <section
      aria-labelledby="next-free"
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="next-free" className="font-medium">
          {t('ipam.nextFree')}
        </h2>
        <Button variant="outline" size="sm" onClick={find} disabled={state.kind === 'busy'}>
          <Search aria-hidden /> {t('ipam.getNextFree')}
        </Button>
        <span aria-live="polite">
          {state.kind === 'done' &&
            (state.address ? (
              <TechText value={state.address} label={t('ipam.nextFree')} alwaysCopy />
            ) : (
              <span className="text-status-down">{t('ipam.noFree')}</span>
            ))}
        </span>
      </div>
      <p className="text-muted-foreground">{t('ipam.nextFreeHint')}</p>
    </section>
  )
}

function RangesSection({
  orgId,
  subnet,
  canEdit,
}: {
  orgId: string
  subnet: SubnetDetail
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const { removeRange } = useIpamMutations(orgId)
  const [editing, setEditing] = useState<IpRange | 'new' | null>(null)
  const [deleting, setDeleting] = useState<IpRange | null>(null)
  return (
    <section aria-labelledby="ranges" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ranges" className="font-semibold">
          {t('ipam.ranges')}
        </h2>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('ipam.rangeAdd')}
          </Button>
        )}
      </div>
      {subnet.ranges.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-3 text-muted-foreground">
          {t('ipam.noRanges')}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ipam.startIp')}</TableHead>
                <TableHead>{t('ipam.endIp')}</TableHead>
                <TableHead>{t('ipam.kind')}</TableHead>
                <TableHead>{t('ipam.purpose')}</TableHead>
                <TableHead>{t('ipam.usage')}</TableHead>
                {canEdit && <TableHead className="w-24">{t('table.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {subnet.ranges.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <TechText value={r.startIp} label={t('ipam.startIp')} />
                  </TableCell>
                  <TableCell>
                    <TechText value={r.endIp} label={t('ipam.endIp')} />
                  </TableCell>
                  <TableCell title={t(`hints.rangeKinds.${r.kind}`)}>
                    {t(`ipam.rangeKinds.${r.kind}`)}
                  </TableCell>
                  <TableCell>{r.purpose}</TableCell>
                  <TableCell>
                    <UsageBar
                      used={r.usedCount}
                      size={r.size}
                      label={`${t('ipam.usage')} ${r.startIp} – ${r.endIp}`}
                    />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <span className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('ipam.rangeEdit')} ${r.startIp} – ${r.endIp}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('ipam.rangeDelete')} ${r.startIp} – ${r.endIp}`}
                          onClick={() => setDeleting(r)}
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
      {editing && (
        <RangeDialog
          orgId={orgId}
          subnet={subnet}
          range={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('ipam.rangeDeleteTitle', {
          start: deleting?.startIp ?? '',
          end: deleting?.endIp ?? '',
        })}
        description={t('ipam.rangeDeleteBody')}
        confirmLabel={t('ipam.rangeDelete')}
        pending={removeRange.isPending}
        onConfirm={() =>
          deleting &&
          removeRange.mutate(
            { subnetId: subnet.id, rangeId: deleting.id },
            {
              onSuccess: () => toast.success(t('ipam.deleted')),
              onSettled: () => setDeleting(null),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />
    </section>
  )
}

function IpsSection({ orgId, subnet }: { orgId: string; subnet: SubnetDetail }) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="ips" className="space-y-2">
      <h2 id="ips" className="font-semibold">
        {t('ipam.ips')}
      </h2>
      {subnet.ips.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-3 text-muted-foreground">
          {t('ipam.noIps')}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ipam.host')}</TableHead>
                <TableHead>{t('ipam.device')}</TableHead>
                <TableHead>{t('ipam.interface')}</TableHead>
                <TableHead>{t('ipam.role')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subnet.ips.map((ip) => (
                <TableRow key={`${ip.deviceId ?? ip.clusterId}-${ip.interfaceName}-${ip.address}`}>
                  <TableCell>
                    <TechText value={ip.address} label={t('ipam.host')} />
                  </TableCell>
                  <TableCell>
                    <HolderLink orgId={orgId} ip={ip} />
                  </TableCell>
                  <TableCell className="font-mono text-tech">
                    {ip.endpointGroupId ? '' : ip.interfaceName}
                  </TableCell>
                  <TableCell>
                    <HolderRole ip={ip} />
                    {ip.host === subnet.gateway && ` · ${t('ipam.gateway')}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {subnet.hiddenCount > 0 && (
        <p className="text-muted-foreground">
          {t('ipam.hiddenIps', { count: subnet.hiddenCount })}
        </p>
      )}
    </section>
  )
}

/** One subnet (P1-10): usage, next free address, planned ranges and the addresses in use. */
export function SubnetDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', subnetId = '' } = useParams()
  const navigate = useNavigate()
  const subnet = useSubnet(orgId, subnetId)
  const { removeSubnet } = useIpamMutations(orgId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const s = subnet.data
  useBreadcrumbs([{ label: t('ipam.title'), to: `/o/${orgId}/ipam` }, { label: s?.cidr ?? '…' }])
  if (subnet.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!s) return <NotFoundPage inShell />
  const canEdit = atLeast(s.access, 'edit')
  const warnings = poolWarnings(s)
  return (
    <div className="max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <Network aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="font-mono text-title font-semibold">{s.cidr}</h1>
            <p className="text-muted-foreground">
              {s.siteCode || t('ipam.orgWide')}
              {s.vrf && ` · VRF ${s.vrf}`}
              {s.description && ` · ${s.description}`}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {t('ipam.editSubnet')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label={t('common.more')} />}
              >
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                  {t('ipam.deleteSubnet')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      {warnings.length > 0 && (
        <section
          aria-label={t('ipam.warnings')}
          className="space-y-1 rounded-md border border-status-warning/50 bg-status-warning/5 p-3 text-sm"
        >
          {warnings.map((w) => (
            <p key={`${w.kind}:${w.host}`}>
              ⚠{' '}
              {t(`ipam.${w.kind === 'gateway-in-dhcp' ? 'gatewayInDhcp' : 'staticInDhcp'}`, {
                host: w.host,
                who: w.who,
                pool: w.pool,
              })}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">{t('ipam.dhcpFix')}</p>
        </section>
      )}
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <KeyValueList
          items={[
            {
              label: t('ipam.gateway'),
              value: s.gateway ? (
                <TechText value={s.gateway} label={t('ipam.gateway')} />
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              ),
            },
            {
              label: t('ipam.vlan'),
              value: <VlanChip vid={s.vlanVid} name={s.vlanName} color={s.vlanColor} />,
            },
            {
              label: t('ipam.size'),
              value: <span data-numeric>{formatSize(s.size)}</span>,
            },
            {
              label: t('ipam.vrf'),
              value: s.vrf || <span className="text-muted-foreground">{t('common.none')}</span>,
            },
          ]}
        />
        <div className="flex items-center gap-6">
          <span className="w-28 shrink-0 text-muted-foreground">{t('ipam.usage')}</span>
          <UsageBar
            used={s.usedCount}
            size={s.size}
            label={`${t('ipam.usage')} ${s.cidr}`}
            barClassName="w-64"
          />
        </div>
      </div>
      <NextFree orgId={orgId} subnetId={s.id} />
      <RangesSection orgId={orgId} subnet={s} canEdit={canEdit} />
      <IpsSection orgId={orgId} subnet={s} />
      {editing && <SubnetDialog orgId={orgId} subnet={s} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('ipam.deleteSubnetTitle', { cidr: s.cidr })}
        description={t('ipam.deleteSubnetBody')}
        confirmLabel={t('ipam.deleteSubnet')}
        pending={removeSubnet.isPending}
        onConfirm={() =>
          removeSubnet.mutate(s.id, {
            onSuccess: () => {
              toast.success(t('ipam.deleted'))
              navigate(`/o/${orgId}/ipam`)
            },
            onSettled: () => setDeleting(false),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
