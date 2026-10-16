import { Cable, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useDeviceList, useInterfaces } from './devices'
import { useEndpointGroups } from './endpoints'
import {
  LINK_KINDS,
  LINK_MEDIA,
  LINK_STATUSES,
  portFits,
  useLinkMutations,
  useLinks,
  type Link,
  type LinkEndKind,
  type LinkKind,
  type LinkStatus,
} from './links'

/** The end a panel is about: a device or an endpoint group. */
export interface LinkOwner {
  kind: LinkEndKind
  id: string
  siteId: string
}

function endHref(orgId: string, kind: LinkEndKind, id: string): string {
  return kind === 'device' ? `/o/${orgId}/devices/${id}` : `/o/${orgId}/endpoint-groups/${id}`
}

/** Orient a link so `near` is the owner's end. */
function orient(l: Link, owner: LinkOwner) {
  const ownerIsA = l.a.kind === owner.kind && l.a.id === owner.id
  return ownerIsA ? { near: l.a, far: l.b } : { near: l.b, far: l.a }
}

/** Ports already cabled on a device (by physical links), except `self`. */
function takenPorts(links: Link[] | undefined, deviceId: string, self?: string): Set<string> {
  const out = new Set<string>()
  for (const l of links ?? []) {
    if (l.kind === 'logical' || l.id === self) continue
    for (const e of [l.a, l.b])
      if (e.kind === 'device' && e.id === deviceId && e.interfaceId) out.add(e.interfaceId)
  }
  return out
}

function PortSelect({
  orgId,
  deviceId,
  kind,
  self,
  value,
  onChange,
  ...p
}: {
  orgId: string
  deviceId: string
  kind: LinkKind
  self?: string
  value: string
  onChange: (v: string) => void
  id: string
  'aria-describedby'?: string
}) {
  const { t } = useTranslation()
  const ports = useInterfaces(orgId, deviceId, deviceId !== '')
  const links = useLinks(orgId, deviceId)
  const taken = takenPorts(links.data, deviceId, self)
  return (
    <NativeSelect
      {...p}
      disabled={!deviceId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('links.noPort')}</option>
      {(ports.data ?? [])
        .filter((i) => portFits(kind, i.kind) || i.id === value)
        .map((i) => {
          const busy = kind !== 'logical' && taken.has(i.id)
          return (
            <option key={i.id} value={i.id} disabled={busy && i.id !== value}>
              {i.name}
              {i.media ? ` · ${i.media}` : ''}
              {busy ? ` (${t('links.portTaken')})` : ''}
            </option>
          )
        })}
    </NativeSelect>
  )
}

function LinkDialog({
  orgId,
  owner,
  link,
  onClose,
}: {
  orgId: string
  owner: LinkOwner
  link?: Link
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useLinkMutations(orgId)
  const ends = link ? orient(link, owner) : null
  const [f, setF] = useState({
    kind: (link?.kind ?? 'ethernet') as LinkKind,
    nearPort: ends?.near.interfaceId ?? '',
    farKind: (ends?.far.kind ?? 'device') as LinkEndKind,
    farId: ends?.far.id ?? '',
    farPort: ends?.far.interfaceId ?? '',
    medium: link?.medium ?? '',
    speed: link?.speed ?? '',
    lengthM: link?.lengthM != null ? String(link.lengthM) : '',
    cableId: link?.cableId ?? '',
    status: (link?.status ?? 'up') as LinkStatus,
    provider: link?.provider ?? '',
    circuitId: link?.circuitId ?? '',
    bandwidth: link?.bandwidth ?? '',
    notes: link?.notes ?? '',
  })
  const [search, setSearch] = useState('')
  // A group end connects only to devices; a device end to devices or groups.
  const farKinds: LinkEndKind[] =
    owner.kind === 'endpoint_group' ? ['device'] : ['device', 'endpoint_group']
  const devices = useDeviceList(orgId, {
    q: search,
    facets: {},
    categoryId: null,
    sort: { id: 'hostname', desc: false },
    pageIndex: 0,
    pageSize: 200,
  })
  const groups = useEndpointGroups(orgId, f.farKind === 'endpoint_group')
  const farOptions =
    f.farKind === 'device'
      ? (devices.data?.devices ?? [])
          .filter((d) => !(owner.kind === 'device' && d.id === owner.id && !f.nearPort))
          .map((d) => ({
            id: d.id,
            label: `${d.hostname} · ${d.siteCode}`,
            sameSite: d.siteId === owner.siteId,
          }))
      : (groups.data ?? []).map((g) => ({
          id: g.id,
          label: `${g.name} · ${g.siteCode}`,
          sameSite: g.siteId === owner.siteId,
        }))
  // Same-site ends first: most cables stay inside a site.
  farOptions.sort((a, b) => Number(b.sameSite) - Number(a.sameSite))
  const keepFar = farOptions.some((o) => o.id === f.farId) || !f.farId
  const end = (kind: LinkEndKind, id: string, port: string) => ({
    kind,
    id,
    interfaceId: kind === 'device' && port ? port : null,
  })
  const title = link ? t('links.edit') : t('links.add')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form
          aria-label={title}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(
              {
                link,
                body: {
                  a: end(owner.kind, owner.id, f.nearPort),
                  b: end(f.farKind, f.farId, f.farPort),
                  kind: f.kind,
                  medium: f.medium.trim(),
                  speed: f.speed.trim(),
                  lengthM: f.lengthM === '' ? null : Number(f.lengthM),
                  cableId: f.cableId.trim(),
                  status: f.status,
                  provider: f.provider.trim(),
                  circuitId: f.circuitId.trim(),
                  bandwidth: f.bandwidth.trim(),
                  notes: f.notes,
                },
              },
              {
                onSuccess: () => {
                  toast.success(t('links.saved'))
                  onClose()
                },
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={t('links.kind')}
              help="link-kind"
              hint={t(`hints.linkKinds.${f.kind}`)}
              className="col-span-2"
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.kind}
                  onChange={(e) =>
                    // Ports of the other family no longer fit: clear them.
                    setF({
                      ...f,
                      kind: e.target.value as LinkKind,
                      nearPort: '',
                      farPort: '',
                      medium: '',
                    })
                  }
                >
                  {LINK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`links.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {owner.kind === 'device' && (
              <FormField
                label={t('links.nearPort')}
                help="interface"
                guide={t('guides.linkPort')}
                className="col-span-2"
              >
                {(p) => (
                  <PortSelect
                    {...p}
                    orgId={orgId}
                    deviceId={owner.id}
                    kind={f.kind}
                    self={link?.id}
                    value={f.nearPort}
                    onChange={(nearPort) => setF({ ...f, nearPort })}
                  />
                )}
              </FormField>
            )}
            <FormField label={t('links.farKind')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.farKind}
                  onChange={(e) =>
                    setF({ ...f, farKind: e.target.value as LinkEndKind, farId: '', farPort: '' })
                  }
                >
                  {farKinds.map((k) => (
                    <option key={k} value={k}>
                      {t(`links.endKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {f.farKind === 'device' ? (
              <FormField label={t('links.search')}>
                {(p) => (
                  <Input
                    {...p}
                    type="search"
                    placeholder={t('links.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                )}
              </FormField>
            ) : (
              <span />
            )}
            <FormField label={t('links.far')} required>
              {(p) => (
                <NativeSelect
                  {...p}
                  required
                  value={keepFar ? f.farId : ''}
                  onChange={(e) => setF({ ...f, farId: e.target.value, farPort: '' })}
                >
                  <option value="">{t('links.chooseFar')}</option>
                  {ends && !farOptions.some((o) => o.id === ends.far.id) && (
                    <option value={ends.far.id}>{ends.far.name}</option>
                  )}
                  {farOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {f.farKind === 'device' ? (
              <FormField label={t('links.farPort')} help="interface">
                {(p) => (
                  <PortSelect
                    {...p}
                    orgId={orgId}
                    deviceId={f.farId}
                    kind={f.kind}
                    self={link?.id}
                    value={f.farPort}
                    onChange={(farPort) => setF({ ...f, farPort })}
                  />
                )}
              </FormField>
            ) : (
              <p className="self-end pb-2 text-muted-foreground">{t('links.groupNoPort')}</p>
            )}
            <FormField label={t('links.medium')} guide={t('guides.linkMedium')}>
              {(p) => (
                <>
                  <Input
                    {...p}
                    list="link-media"
                    maxLength={40}
                    value={f.medium}
                    onChange={(e) => setF({ ...f, medium: e.target.value })}
                  />
                  <datalist id="link-media">
                    {LINK_MEDIA[f.kind].map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label={t('links.speed')} hint={t('links.speedHint')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={20}
                  value={f.speed}
                  onChange={(e) => setF({ ...f, speed: e.target.value })}
                />
              )}
            </FormField>
            <FormField label={t('links.status')} guide={t('guides.linkStatus')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.status}
                  onChange={(e) => setF({ ...f, status: e.target.value as LinkStatus })}
                >
                  {LINK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`links.statuses.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('links.cableId')} guide={t('guides.cableId')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={64}
                  value={f.cableId}
                  onChange={(e) => setF({ ...f, cableId: e.target.value })}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('links.length')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={f.lengthM}
                  onChange={(e) => setF({ ...f, lengthM: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <details
            className="rounded-md border border-border p-3"
            open={Boolean(f.provider || f.circuitId)}
          >
            <summary className="cursor-pointer font-medium">{t('links.wan')}</summary>
            <p className="mt-1 text-muted-foreground">{t('guides.linkWan')}</p>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <FormField label={t('links.provider')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={100}
                    value={f.provider}
                    onChange={(e) => setF({ ...f, provider: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('links.circuitId')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={100}
                    value={f.circuitId}
                    onChange={(e) => setF({ ...f, circuitId: e.target.value })}
                    className="font-mono"
                  />
                )}
              </FormField>
              <FormField label={t('links.bandwidth')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={40}
                    value={f.bandwidth}
                    onChange={(e) => setF({ ...f, bandwidth: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </details>
          <FormField label={t('links.notes')}>
            {(p) => (
              <Input
                {...p}
                maxLength={2000}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
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
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Links of a device or endpoint group (P1-12): list, add, edit, delete. */
export function LinksPanel({
  orgId,
  owner,
  canEdit,
}: {
  orgId: string
  owner: LinkOwner
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const links = useLinks(orgId, owner.id)
  const { remove } = useLinkMutations(orgId)
  const [editing, setEditing] = useState<Link | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Link | null>(null)
  if (links.isPending) return <Skeleton className="h-24" />
  if (links.isError)
    return (
      <p role="alert" className="text-destructive">
        {links.error.message}
      </p>
    )
  return (
    <section aria-label={t('links.title')} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{t('links.subtitle')}</p>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('links.add')}
          </Button>
        )}
      </div>
      {links.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={<Cable />}
            title={t('links.empty')}
            description={t('links.emptyBody')}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {owner.kind === 'device' && <TableHead>{t('links.nearPort')}</TableHead>}
                <TableHead>{t('links.far')}</TableHead>
                <TableHead>{t('links.farPort')}</TableHead>
                <TableHead>{t('links.kind')}</TableHead>
                <TableHead>{t('links.status')}</TableHead>
                <TableHead>{t('links.cableId')}</TableHead>
                {canEdit && <TableHead className="w-24">{t('table.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.data.map((l) => {
                const { near, far } = orient(l, owner)
                const editable = l.access !== 'view'
                return (
                  <TableRow key={l.id}>
                    {owner.kind === 'device' && (
                      <TableCell className="font-mono text-tech">
                        {near.interfaceName || (
                          <span className="font-sans text-muted-foreground">
                            {t('links.unassigned')}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <RouterLink
                        to={endHref(orgId, far.kind, far.id)}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {far.name}
                      </RouterLink>
                      {far.siteId !== owner.siteId && (
                        <span className="ml-2 text-muted-foreground">{far.siteCode}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-tech">
                      {far.interfaceName || (
                        <span className="font-sans text-muted-foreground">
                          {far.kind === 'endpoint_group' ? t('common.none') : t('links.unassigned')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t(`links.kinds.${l.kind}`)}
                      {[l.medium, l.speed].filter(Boolean).length > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {[l.medium, l.speed].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} label={t(`links.statuses.${l.status}`)} />
                    </TableCell>
                    <TableCell className="font-mono text-tech">{l.cableId}</TableCell>
                    {canEdit && (
                      <TableCell>
                        {editable && (
                          <span className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${t('links.edit')} ${far.name}`}
                              onClick={() => setEditing(l)}
                            >
                              <Pencil aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${t('links.delete')} ${far.name}`}
                              onClick={() => setDeleting(l)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <LinkDialog
          orgId={orgId}
          owner={owner}
          link={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('links.deleteTitle', { name: deleting ? orient(deleting, owner).far.name : '' })}
        description={t('links.deleteBody')}
        confirmLabel={t('links.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </section>
  )
}
