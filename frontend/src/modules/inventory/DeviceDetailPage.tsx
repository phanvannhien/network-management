import { Info, MoreHorizontal, Network, Pencil, Server } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMfaVerify, useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { KeyValueList } from '@/components/KeyValueList'
import { SecretField } from '@/components/SecretField'
import { StatusBadge } from '@/components/StatusBadge'
import { TechText } from '@/components/TechText'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime } from '@/lib/format'
import { NotFoundPage } from '@/app/NotFoundPage'
import { WarrantyText } from './DeviceListPage'
import { useDevice } from './devices'
import {
  sampleCredentials,
  sampleInterfaces,
  TYPE_LABELS,
  type SampleDevice,
  type SampleInterface,
} from './sampleDevices'

const TABS = [
  'overview',
  'interfaces',
  'ips',
  'links',
  'access',
  'contracts',
  'diagrams',
  'history',
] as const
type Tab = (typeof TABS)[number]

/** Read-only table styled like DataTable, for short per-device lists. */
function PlainTable({
  caption,
  head,
  children,
}: {
  caption: string
  head: ReactNode[]
  children: ReactNode
}) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-card focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <table className="w-full border-separate border-spacing-0 text-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="h-8 border-b border-border px-cell-x text-left text-label font-medium whitespace-nowrap text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:h-row [&_td]:border-b [&_td]:border-border [&_td]:px-cell-x [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0 [&_tr:hover]:bg-muted">
          {children}
        </tbody>
      </table>
    </div>
  )
}

function InterfacesTab({ device }: { device: SampleDevice }) {
  const { t } = useTranslation()
  const ports: SampleInterface[] = sampleInterfaces(device)
  return (
    <PlainTable
      caption={t('devices.tabInterfaces')}
      head={[
        t('devices.port'),
        t('devices.portType'),
        t('devices.media'),
        t('devices.speed'),
        t('devices.mode'),
        t('devices.vlan'),
        t('devices.connectedTo'),
        t('devices.status'),
      ]}
    >
      {ports.map((p) => (
        <tr key={p.name}>
          <td>
            <TechText value={p.name} label={t('devices.port')} copy={false} />
          </td>
          <td>{p.type}</td>
          <td>{p.media}</td>
          <td data-numeric>{p.speed}</td>
          <td>{p.mode}</td>
          <td>
            <TechText value={p.vlan} label={t('devices.vlan')} copy={false} />
          </td>
          <td>
            {p.connectedTo ? (
              <span className="font-medium">{p.connectedTo}</span>
            ) : (
              <span className="text-muted-foreground">{t('devices.notConnected')}</span>
            )}
          </td>
          <td>
            <StatusBadge status={p.status} />
          </td>
        </tr>
      ))}
    </PlainTable>
  )
}

function AccessTab({ device }: { device: SampleDevice }) {
  const { t } = useTranslation()
  const session = useSession()
  const verify = useMfaVerify()
  const mfa = session.data?.mfa
  // Sample secrets: the real reveal endpoint (P2-02) checks credential.reveal + recent MFA and audits.
  // Accounts without MFA have nothing to re-verify in this sample.
  const [openedAt] = useState(() => new Date().toISOString())
  const verifiedAt = mfa?.enabled ? mfa.verifiedAt : openedAt
  return (
    <PlainTable
      caption={t('devices.credentials')}
      head={[t('devices.protocol'), t('devices.username'), t('devices.secretPassword')]}
    >
      {sampleCredentials(device).map((c) => (
        <tr key={c.id}>
          <td>{c.protocol}</td>
          <td>
            <TechText value={c.username} label={t('devices.username')} />
          </td>
          <td>
            <SecretField
              label={`${t('devices.secretPassword')} ${c.protocol}`}
              reveal={async () => c.secret}
              mfaVerifiedAt={verifiedAt}
              verifyMfa={async (code) => {
                await verify.mutateAsync({ code })
              }}
            />
          </td>
        </tr>
      ))}
    </PlainTable>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy>
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** Device detail (DESIGN.md §7b) on sample data until P1-08. Tab is kept in ?tab= for deep links. */
export function DeviceDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', deviceId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const device = useDevice(orgId, deviceId)
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const d = device.data
  useBreadcrumbs([
    { label: t('nav.devices'), to: `/o/${orgId}/devices` },
    { label: d?.hostname ?? '…' },
  ])

  if (device.isPending) return <DetailSkeleton />
  if (!d) return <NotFoundPage inShell />

  const sample = () => toast(t('devices.sampleAction'))
  const ports = sampleInterfaces(d)
  const statusLabel =
    d.status === 'down' || d.status === 'warning'
      ? `${t(`status.${d.status}`)} · ${t('devices.since', { time: formatDateTime(d.statusSince) })}`
      : undefined

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <Server aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-title font-semibold">{d.hostname}</h1>
              <StatusBadge status={d.status} label={statusLabel} />
              <span className="text-muted-foreground">
                {d.site} › {d.location}
                {d.rack && ` › ${d.rack}`}
              </span>
            </div>
            <p className="text-muted-foreground">
              {TYPE_LABELS[d.type]} · {d.role} · {t(`devices.lifecycleValues.${d.lifecycle}`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/editor')}>
            <Network aria-hidden /> {t('devices.openDiagram')}
          </Button>
          <Button variant="outline" onClick={sample}>
            <Pencil aria-hidden /> {t('devices.edit')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" aria-label={t('common.more')} />}
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                {t('devices.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Alert className="py-2">
        <Info aria-hidden />
        <AlertDescription>{t('devices.sampleBanner')}</AlertDescription>
      </Alert>

      <section
        aria-label={t('devices.tabOverview')}
        className="rounded-lg border border-border bg-card p-3"
      >
        <KeyValueList
          columns={4}
          items={[
            { label: t('devices.model'), value: d.model },
            {
              label: t('devices.partNumber'),
              value: <TechText value={d.partNumber} label={t('devices.partNumber')} />,
            },
            {
              label: t('devices.serial'),
              value: d.serial ? (
                <TechText value={d.serial} label={t('devices.serial')} />
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              ),
            },
            { label: t('devices.vendor'), value: d.vendor },
            {
              label: t('devices.mgmtIp'),
              value: <TechText value={`${d.mgmtIp}/${d.prefix}`} label={t('devices.mgmtIp')} />,
            },
            { label: t('devices.firmware'), value: d.firmware },
            { label: t('devices.mac'), value: <TechText value={d.mac} label={t('devices.mac')} /> },
            { label: t('devices.warranty'), value: <WarrantyText date={d.warrantyEnd} /> },
          ]}
        />
      </section>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}>
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="overview">{t('devices.tabOverview')}</TabsTrigger>
          <TabsTrigger value="interfaces">
            {t('devices.tabInterfaces')}{' '}
            <span className="text-muted-foreground" data-numeric>
              {ports.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="ips">{t('devices.tabIps')}</TabsTrigger>
          <TabsTrigger value="links">{t('devices.tabLinks')}</TabsTrigger>
          <TabsTrigger value="access">{t('devices.tabAccess')}</TabsTrigger>
          <TabsTrigger value="contracts">{t('devices.tabContracts')}</TabsTrigger>
          <TabsTrigger value="diagrams">{t('devices.tabDiagrams')}</TabsTrigger>
          <TabsTrigger value="history">{t('devices.tabHistory')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <KeyValueList
              columns={2}
              items={[
                { label: t('devices.site'), value: d.site },
                { label: t('devices.rack'), value: d.rack ?? t('common.none') },
                { label: t('devices.owner'), value: d.owner },
                {
                  label: t('devices.tags'),
                  value: d.tags.length ? d.tags.join(', ') : t('common.none'),
                },
                { label: t('devices.role'), value: d.role },
                {
                  label: t('devices.lifecycle'),
                  value: t(`devices.lifecycleValues.${d.lifecycle}`),
                },
              ]}
            />
          </div>
        </TabsContent>
        <TabsContent value="interfaces" className="pt-3">
          <InterfacesTab device={d} />
        </TabsContent>
        <TabsContent value="access" className="pt-3">
          <AccessTab device={d} />
        </TabsContent>
        {(['ips', 'links', 'contracts', 'diagrams', 'history'] as const).map((v) => (
          <TabsContent key={v} value={v} className="pt-3">
            <div className="rounded-lg border border-border bg-card">
              <EmptyState title={t('devices.comingSoon')} />
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('devices.deleteTitle', { name: d.hostname })}
        description={t('devices.deleteBody')}
        confirmLabel={t('devices.delete')}
        onConfirm={() => {
          setConfirmDelete(false)
          sample()
        }}
      />
    </div>
  )
}
