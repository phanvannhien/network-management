import { Cable, History, KeyRound, MoreHorizontal, Network, Pencil, Server } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, formatDateTime } from '@/lib/format'
import { atLeast } from '@/modules/sites/access'
import { WarrantyText } from './DeviceListPage'
import { DeviceFormDialog } from './DeviceFormDialog'
import {
  useCustomFields,
  useDeleteDevices,
  useDevice,
  useDeviceHistory,
  type Device,
  type HistoryEntry,
} from './devices'

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

const none = (v: string | null | undefined, empty: string) => (v ? v : empty)

/** Fields that changed between two audit snapshots, as "field: from → to". */
function changes(e: HistoryEntry): { field: string; from: string; to: string }[] {
  if (!e.before || !e.after) return []
  const show = (v: unknown) =>
    v === undefined || v === null || v === ''
      ? '—'
      : Array.isArray(v)
        ? v.join(', ') || '—'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v)
  const keys = new Set([...Object.keys(e.before), ...Object.keys(e.after)])
  return [...keys]
    .filter((k) => show(e.before?.[k]) !== show(e.after?.[k]))
    .map((k) => ({ field: k, from: show(e.before?.[k]), to: show(e.after?.[k]) }))
}

function HistoryTab({ orgId, deviceId }: { orgId: string; deviceId: string }) {
  const { t } = useTranslation()
  const history = useDeviceHistory(orgId, deviceId)
  if (history.isPending) return <Skeleton className="h-32" />
  if (history.isError)
    return (
      <p role="alert" className="text-destructive">
        {history.error.message}
      </p>
    )
  if (history.data.length === 0)
    return (
      <div className="rounded-lg border border-border bg-card">
        <EmptyState icon={<History />} title={t('devices.historyEmpty')} />
      </div>
    )
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-card">
      {history.data.map((e) => (
        <li key={e.id} className="space-y-1 px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">
              {t(`devices.historyActions.${e.action as 'device.update'}`, {
                defaultValue: e.action,
              })}
            </span>
            <span className="text-muted-foreground">
              {t('devices.historyBy', {
                who: e.actorName || e.actorEmail || '—',
                when: formatDateTime(e.at),
              })}
            </span>
          </div>
          {changes(e).length > 0 && (
            <ul className="text-muted-foreground">
              {changes(e).map((c) => (
                <li key={c.field}>
                  <span className="font-mono text-tech">{c.field}</span>: {c.from} → {c.to}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function Soon({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <EmptyState icon={icon} title={text} />
    </div>
  )
}

/** Device detail (P1-08, DESIGN.md §7b). Tab is kept in ?tab= for deep links. */
export function DeviceDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', deviceId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const device = useDevice(orgId, deviceId)
  const fields = useCustomFields(orgId)
  const del = useDeleteDevices(orgId)
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const d: Device | null | undefined = device.data
  useBreadcrumbs([
    { label: t('nav.devices'), to: `/o/${orgId}/devices` },
    { label: d?.hostname ?? '…' },
  ])

  if (device.isPending) return <DetailSkeleton />
  if (!d) return <NotFoundPage inShell />

  const dash = t('common.none')
  const canEdit = atLeast(d.access, 'edit')
  const tech = (v: string, label: string) =>
    v ? <TechText value={v} label={label} /> : <span className="text-muted-foreground">{dash}</span>
  const date = (v: string | null) => (v ? formatDate(v) : dash)
  const customValue = (v: unknown) =>
    v === undefined || v === null || v === ''
      ? dash
      : typeof v === 'boolean'
        ? v
          ? t('devices.yes')
          : t('devices.no')
        : String(v)

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
              <span className="text-muted-foreground">
                <Link to={`/o/${orgId}/sites/${d.siteId}`} className="hover:underline">
                  {d.siteCode}
                </Link>
                {d.locationName && ` › ${d.locationName}`}
                {d.rackName && ` › ${d.rackName}${d.rackU ? ` U${d.rackU}` : ''}`}
              </span>
            </div>
            <p className="text-muted-foreground">
              {t(`devices.types.${d.type}`)} · {t(`devices.lifecycleValues.${d.lifecycle}`)} ·{' '}
              {d.partnerCode} › {d.unitCode}
              {!d.managed && ` · ${t('devices.external')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
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
            </>
          ) : (
            <span className="text-muted-foreground">{t('devices.readOnly')}</span>
          )}
        </div>
      </header>

      <section
        aria-label={t('devices.groupIdentity')}
        className="rounded-lg border border-border bg-card p-3"
      >
        <KeyValueList
          columns={4}
          items={[
            { label: t('devices.vendor'), value: none(d.vendor, dash) },
            { label: t('devices.model'), value: none(d.model, dash) },
            { label: t('devices.partNumber'), value: tech(d.partNumber, t('devices.partNumber')) },
            { label: t('devices.serial'), value: tech(d.serialNumber, t('devices.serial')) },
            { label: t('devices.assetTag'), value: none(d.assetTag, dash) },
            { label: t('devices.firmware'), value: none(d.firmware, dash) },
            { label: t('devices.role'), value: t(`devices.roleValues.${d.role}`) },
            { label: t('devices.warranty'), value: <WarrantyText date={d.warrantyEnd} /> },
          ]}
        />
      </section>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}>
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="overview">{t('devices.tabOverview')}</TabsTrigger>
          <TabsTrigger value="interfaces">{t('devices.tabInterfaces')}</TabsTrigger>
          <TabsTrigger value="ips">{t('devices.tabIps')}</TabsTrigger>
          <TabsTrigger value="links">{t('devices.tabLinks')}</TabsTrigger>
          <TabsTrigger value="access">{t('devices.tabAccess')}</TabsTrigger>
          <TabsTrigger value="contracts">{t('devices.tabContracts')}</TabsTrigger>
          <TabsTrigger value="diagrams">{t('devices.tabDiagrams')}</TabsTrigger>
          <TabsTrigger value="history">{t('devices.tabHistory')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-3 pt-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <KeyValueList
              columns={2}
              wrap
              items={[
                {
                  label: t('devices.unit'),
                  value: `${d.partnerCode} › ${d.unitCode} · ${d.unitName}`,
                },
                { label: t('devices.site'), value: `${d.siteCode} · ${d.siteName}` },
                { label: t('devices.location'), value: none(d.locationName, dash) },
                {
                  label: t('devices.rack'),
                  value: d.rackName
                    ? `${d.rackName}${
                        d.rackU
                          ? d.uHeight > 1
                            ? ` · U${d.rackU}–U${d.rackU + d.uHeight - 1}`
                            : ` · U${d.rackU}`
                          : ''
                      }`
                    : dash,
                },
                { label: t('devices.owner'), value: none(d.ownerName, dash) },
                { label: t('devices.tags'), value: d.tags.length ? d.tags.join(', ') : dash },
                { label: t('devices.notes'), value: none(d.notes, dash) },
              ]}
            />
          </div>
          {(fields.data ?? []).length > 0 && (
            <section
              aria-label={t('devices.groupCustom')}
              className="rounded-lg border border-border bg-card p-3"
            >
              <h2 className="mb-2 text-sm font-semibold">{t('devices.groupCustom')}</h2>
              <KeyValueList
                columns={2}
                wrap
                items={(fields.data ?? []).map((f) => ({
                  label: f.label,
                  value: customValue(d.customFields[f.key]),
                }))}
              />
            </section>
          )}
        </TabsContent>
        <TabsContent value="interfaces" className="pt-3">
          <Soon icon={<Cable />} text={t('devices.interfacesSoon')} />
        </TabsContent>
        <TabsContent value="ips" className="pt-3">
          <Soon icon={<Cable />} text={t('devices.interfacesSoon')} />
        </TabsContent>
        <TabsContent value="links" className="pt-3">
          <Soon icon={<Network />} text={t('devices.linksSoon')} />
        </TabsContent>
        <TabsContent value="access" className="pt-3">
          <Soon icon={<KeyRound />} text={t('devices.accessSoon')} />
        </TabsContent>
        <TabsContent value="contracts" className="space-y-2 pt-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <KeyValueList
              columns={2}
              wrap
              items={[
                { label: t('devices.purchaseDate'), value: date(d.purchaseDate) },
                { label: t('devices.poNumber'), value: none(d.poNumber, dash) },
                { label: t('devices.warranty'), value: <WarrantyText date={d.warrantyEnd} /> },
                { label: t('devices.licenseEnd'), value: date(d.licenseEnd) },
                { label: t('devices.eolDate'), value: date(d.eolDate) },
                { label: t('devices.eosDate'), value: date(d.eosDate) },
              ]}
            />
          </div>
          <p className="text-muted-foreground">{t('devices.contractsHint')}</p>
        </TabsContent>
        <TabsContent value="diagrams" className="pt-3">
          <Soon icon={<Network />} text={t('devices.diagramsSoon')} />
        </TabsContent>
        <TabsContent value="history" className="pt-3">
          {tab === 'history' && <HistoryTab orgId={orgId} deviceId={d.id} />}
        </TabsContent>
      </Tabs>

      {editing && <DeviceFormDialog orgId={orgId} device={d} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('devices.deleteTitle', { name: d.hostname })}
        description={t('devices.deleteBody')}
        confirmLabel={t('devices.delete')}
        pending={del.isPending}
        onConfirm={() =>
          del.mutate([d.id], {
            onSuccess: () => {
              toast.success(t('devices.deleted', { count: 1 }))
              navigate(`/o/${orgId}/devices`, { replace: true })
            },
            onError: (e) => {
              setConfirmDelete(false)
              toast.error(e.message)
            },
          })
        }
      />
    </div>
  )
}
