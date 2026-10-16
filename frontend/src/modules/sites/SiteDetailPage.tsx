import { SiteSharesPanel } from './SiteSharesPanel'
import { atLeast } from './access'
import { MapPin, MoreHorizontal, Network, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { KeyValueList } from '@/components/KeyValueList'
import { NativeSelect } from '@/components/NativeSelect'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { LocationTree } from './LocationTree'
import { SiteFormDialog } from './SiteFormDialog'
import {
  locationPath,
  useDeleteSite,
  useLocations,
  useRackMutations,
  useRacks,
  useSite,
  type Location,
  type Rack,
} from './sites'

const TABS = ['locations', 'racks', 'info', 'devices', 'diagrams', 'shares'] as const
type Tab = (typeof TABS)[number]

function RackDialog({
  orgId,
  siteId,
  locations,
  rack,
  onClose,
}: {
  orgId: string
  siteId: string
  locations: Location[]
  rack?: Rack
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useRackMutations(orgId, siteId)
  const [name, setName] = useState(rack?.name ?? '')
  const [locationId, setLocationId] = useState(
    rack?.locationId ?? locations.find((l) => l.kind === 'room')?.id ?? locations[0]?.id ?? '',
  )
  const [uHeight, setUHeight] = useState(String(rack?.uHeight ?? 42))
  const [notes, setNotes] = useState(rack?.notes ?? '')
  const options = locations
    .map((l) => ({ id: l.id, path: locationPath(locations, l.id) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'vi'))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { rack, body: { name, locationId, uHeight: Number(uHeight), notes } },
      {
        onSuccess: () => {
          toast.success(t('sites.saved'))
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{rack ? t('sites.editRack') : t('sites.addRack')}</DialogTitle>
          </DialogHeader>
          <FormField label={t('sites.rackName')} required>
            {(p) => (
              <Input
                {...p}
                required
                autoFocus
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('sites.rackLocation')} required>
            {(p) => (
              <NativeSelect
                {...p}
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.path}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label={t('sites.rackU')} required>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={60}
                required
                value={uHeight}
                onChange={(e) => setUHeight(e.target.value)}
                className="w-28"
              />
            )}
          </FormField>
          <FormField label={t('sites.notes')}>
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </FormField>
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !locationId}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Front view: U numbered bottom-up like the rack rails; slots are empty until devices exist (P1-08). */
function RackView({ rack }: { rack: Rack }) {
  const { t } = useTranslation()
  const units = Array.from({ length: rack.uHeight }, (_, i) => rack.uHeight - i)
  return (
    <figure className="space-y-2">
      <figcaption className="font-semibold">{t('sites.rackView', { name: rack.name })}</figcaption>
      <div className="w-72 rounded-md border-2 border-border-control bg-muted p-1.5">
        <ol aria-label={t('sites.rackView', { name: rack.name })} className="space-y-px">
          {units.map((u) => (
            <li
              key={u}
              className="grid h-4 grid-cols-[28px_1fr_28px] items-center text-[10px] leading-none"
            >
              <span className="text-right font-mono text-muted-foreground" aria-hidden>
                {u}
              </span>
              <span className="mx-1 h-full rounded-[2px] border border-dashed border-border bg-card">
                <span className="sr-only">{`U${u}: ${t('sites.rackFree')}`}</span>
              </span>
              <span className="font-mono text-muted-foreground" aria-hidden>
                {u}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-label text-muted-foreground">{t('sites.rackHint')}</p>
    </figure>
  )
}

function RacksTab({ orgId, siteId, canEdit }: { orgId: string; siteId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const racks = useRacks(orgId, siteId)
  const locations = useLocations(orgId, siteId)
  const { remove } = useRackMutations(orgId, siteId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Rack | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Rack | null>(null)
  const list = racks.data ?? []
  const locs = locations.data ?? []
  const selected = list.find((r) => r.id === selectedId) ?? list[0]

  if (racks.isPending || locations.isPending) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing('new')}
          disabled={locs.length === 0}
        >
          <Plus aria-hidden /> {t('sites.addRack')}
        </Button>
      )}
      {canEdit && locs.length === 0 && (
        <p className="text-muted-foreground">{t('sites.rackNeedsLocation')}</p>
      )}
      {remove.isError && (
        <p role="alert" className="text-destructive">
          {remove.error.message}
        </p>
      )}
      {list.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<Server />} title={t('sites.rackEmpty')} />
        </div>
      ) : (
        <div className="flex items-start gap-6">
          <ul
            aria-label={t('sites.racks')}
            className="w-96 divide-y divide-border rounded-lg border border-border bg-card"
          >
            {list.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 px-3 py-2"
                data-selected={r.id === selected?.id || undefined}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-current={r.id === selected?.id || undefined}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={r.id === selected?.id ? 'font-semibold text-primary' : 'font-medium'}
                  >
                    {r.name}
                  </span>
                  <span className="block truncate text-label text-muted-foreground">
                    {locationPath(locs, r.locationId)} · {r.uHeight}U
                  </span>
                </button>
                {canEdit && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setEditing(r)}
                      aria-label={`${t('sites.editRack')} ${r.name}`}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleting(r)}
                      aria-label={`${t('sites.deleteRack')} ${r.name}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {selected && <RackView rack={selected} />}
        </div>
      )}
      {editing && (
        <RackDialog
          orgId={orgId}
          siteId={siteId}
          locations={locs}
          rack={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('sites.deleteRackTitle', { name: deleting?.name ?? '' })}
        description={t('sites.deleteRackBody')}
        confirmLabel={t('sites.deleteRack')}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}

/** Site detail (P1-07): location tree, racks with a front view, details; devices/diagrams come later. */
export function SiteDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', siteId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const site = useSite(orgId, siteId)
  const locations = useLocations(orgId, siteId)
  const del = useDeleteSite(orgId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const tab: Tab = TABS.includes(params.get('tab') as Tab)
    ? (params.get('tab') as Tab)
    : 'locations'
  const s = site.data
  useBreadcrumbs([
    { label: t('units.hub'), to: `/o/${orgId}/sites` },
    ...(s?.businessUnitId && s.partnerId
      ? [
          { label: s.partnerCode, to: `/o/${orgId}/partners/${s.partnerId}` },
          { label: s.businessUnitCode, to: `/o/${orgId}/units/${s.businessUnitId}` },
        ]
      : [{ label: t('units.sharedShort'), to: `/o/${orgId}/sites?tab=sites` }]),
    { label: s?.code ?? '…' },
  ])

  // Access on this site (ADR-031): its unit's grants, the organization role, or a share.
  const canEdit = atLeast(s?.access, 'edit')
  const canAdmin = atLeast(s?.access, 'admin')

  if (site.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!s) return <NotFoundPage inShell />

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <MapPin aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h1 className="text-title font-semibold">
                {s.code} <span className="font-normal text-muted-foreground">· {s.name}</span>
              </h1>
            </div>
            <p className="text-muted-foreground">
              {t(`sites.siteKinds.${s.kind}`)} ·{' '}
              {s.businessUnitId
                ? `${s.partnerCode} › ${s.businessUnitCode} · ${s.businessUnitName}`
                : t('units.shared')}
              {s.address && ` · ${s.address}`}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {t('sites.edit')}
            </Button>
            {canAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon" aria-label={t('common.more')} />}
                >
                  <MoreHorizontal aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                    {t('sites.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </header>
      {!canEdit && <p className="text-muted-foreground">{t('sites.readOnly')}</p>}

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}>
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="locations">
            {t('sites.tabLocations')}{' '}
            <span className="text-muted-foreground" data-numeric>
              {s.locationCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="racks">
            {t('sites.tabRacks')}{' '}
            <span className="text-muted-foreground" data-numeric>
              {s.rackCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="info">{t('sites.tabInfo')}</TabsTrigger>
          <TabsTrigger value="devices">{t('sites.tabDevices')}</TabsTrigger>
          <TabsTrigger value="diagrams">{t('sites.tabDiagrams')}</TabsTrigger>
          {canAdmin && <TabsTrigger value="shares">{t('shares.tab')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="locations" className="pt-3">
          {locations.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <LocationTree
              orgId={orgId}
              siteId={siteId}
              locations={locations.data ?? []}
              canEdit={canEdit}
            />
          )}
        </TabsContent>
        <TabsContent value="racks" className="pt-3">
          <RacksTab orgId={orgId} siteId={siteId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="info" className="pt-3">
          <div className="max-w-3xl rounded-lg border border-border bg-card p-4">
            <KeyValueList
              columns={2}
              wrap
              items={[
                { label: t('sites.code'), value: s.code },
                { label: t('sites.name'), value: s.name },
                {
                  label: t('sites.unit'),
                  value: s.businessUnitId
                    ? `${s.businessUnitCode} · ${s.businessUnitName}`
                    : t('units.shared'),
                },
                { label: t('sites.kind'), value: t(`sites.siteKinds.${s.kind}`) },
                { label: t('sites.isp'), value: s.isp || t('common.none') },
                { label: t('sites.address'), value: s.address || t('common.none') },
                {
                  label: t('sites.timezone'),
                  value: <span className="font-mono text-tech">{s.timezone}</span>,
                },
                { label: t('sites.contactName'), value: s.contactName || t('common.none') },
                { label: t('sites.contactPhone'), value: s.contactPhone || t('common.none') },
                { label: t('sites.contactEmail'), value: s.contactEmail || t('common.none') },
                { label: t('sites.notes'), value: s.notes || t('common.none') },
              ]}
            />
          </div>
        </TabsContent>
        <TabsContent value="devices" className="pt-3">
          <div className="rounded-lg border border-border bg-card">
            <EmptyState icon={<Server />} title={t('sites.devicesSoon')} />
          </div>
        </TabsContent>
        {canAdmin && (
          <TabsContent value="shares" className="pt-3">
            <SiteSharesPanel orgId={orgId} site={s} />
          </TabsContent>
        )}
        <TabsContent value="diagrams" className="pt-3">
          <div className="rounded-lg border border-border bg-card">
            <EmptyState icon={<Network />} title={t('sites.diagramsSoon')} />
          </div>
        </TabsContent>
      </Tabs>

      {editing && <SiteFormDialog orgId={orgId} site={s} open onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('sites.deleteTitle', { code: s.code })}
        description={t('sites.deleteBody')}
        consequences={[
          t('sites.deleteConsequenceLocations', { count: s.locationCount, racks: s.rackCount }),
          t('sites.deleteConsequenceScope'),
        ]}
        confirmText={s.code}
        confirmLabel={t('sites.delete')}
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(s.id, {
            onSuccess: () => {
              toast.success(t('sites.saved'))
              navigate(`/o/${orgId}/sites`, { replace: true })
            },
          })
        }
      />
    </div>
  )
}
