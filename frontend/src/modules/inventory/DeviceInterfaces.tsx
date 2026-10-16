import { Cable, MoreHorizontal, Plus, Star } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  deviceToInput,
  INTERFACE_KINDS,
  IP_ROLES,
  MEDIA,
  MODES,
  useDeviceIps,
  useInterfaceMutations,
  useInterfaces,
  useIpMutations,
  useSaveDevice,
  useTemplates,
  type Device,
  type Interface,
  type InterfaceKind,
  type InterfaceMedia,
  type InterfaceMode,
  type IpAddress,
  type IpRole,
} from './devices'

/** Read-only table styled like DataTable, for per-device lists. */
export function PlainTable({
  caption,
  head,
  children,
}: {
  caption: string
  head: ReactNode[]
  children: ReactNode
}) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-card">
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

const optNum = (v: string) => (v.trim() === '' ? null : Number(v))

function InterfaceDialog({
  orgId,
  device,
  iface,
  interfaces,
  onClose,
}: {
  orgId: string
  device: Device
  iface?: Interface
  interfaces: Interface[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useInterfaceMutations(orgId, device.id)
  const [f, setF] = useState({
    name: iface?.name ?? '',
    kind: (iface?.kind ?? 'svi') as InterfaceKind,
    media: (iface?.media ?? '') as InterfaceMedia,
    speed: iface?.speed ?? '',
    mode: (iface?.mode ?? '') as InterfaceMode,
    accessVlan: iface?.accessVlan ? String(iface.accessVlan) : '',
    nativeVlan: iface?.nativeVlan ? String(iface.nativeVlan) : '',
    allowedVlans: iface?.allowedVlans ?? '',
    poe: iface?.poe ?? false,
    lagId: iface?.lagId ?? '',
    description: iface?.description ?? '',
    adminUp: iface?.adminUp ?? true,
    mac: iface?.mac ?? '',
    vlanTag: iface?.vlanTag ? String(iface.vlanTag) : '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const lags = interfaces.filter((i) => i.kind === 'lag' && i.id !== iface?.id)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        iface,
        body: {
          name: f.name.trim(),
          kind: f.kind,
          media: f.media,
          speed: f.speed,
          mode: f.mode,
          accessVlan: optNum(f.accessVlan),
          nativeVlan: optNum(f.nativeVlan),
          allowedVlans: f.allowedVlans,
          poe: f.poe,
          lagId: f.kind === 'lag' ? null : f.lagId || null,
          description: f.description,
          adminUp: f.adminUp,
          mac: f.mac.trim() || null,
          vlanTag: f.kind === 'subinterface' ? optNum(f.vlanTag) : null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('devices.saved'))
          onClose()
        },
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={iface ? t('devices.ifaceEdit', { name: iface.name }) : t('devices.ifaceAdd')}
        >
          <DialogHeader>
            <DialogTitle>
              {iface ? t('devices.ifaceEdit', { name: iface.name }) : t('devices.ifaceAdd')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t('devices.ifaceName')} required>
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={64}
                  value={f.name}
                  onChange={set('name')}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('devices.ifaceKind')} hint={t(`hints.ifaceKinds.${f.kind}`)}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value as InterfaceKind })}
                >
                  {INTERFACE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`devices.ifaceKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.media')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.media}
                  onChange={(e) => setF({ ...f, media: e.target.value as InterfaceMedia })}
                >
                  {MEDIA.map((m) => (
                    <option key={m} value={m}>
                      {m || t('devices.noMedia')}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.speed')}>
              {(p) => <Input {...p} maxLength={20} value={f.speed} onChange={set('speed')} />}
            </FormField>
            <FormField label={t('devices.mode')} hint={t('hints.mode')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.mode}
                  onChange={(e) => setF({ ...f, mode: e.target.value as InterfaceMode })}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m ? t(`devices.modes.${m}`) : '—'}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.lag')} hint={t('hints.lag')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.lagId}
                  disabled={f.kind === 'lag'}
                  onChange={set('lagId')}
                >
                  <option value="">{t('devices.noLag')}</option>
                  {lags.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.accessVlan')} hint={t('hints.accessVlan')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={4094}
                  value={f.accessVlan}
                  onChange={set('accessVlan')}
                />
              )}
            </FormField>
            <FormField label={t('devices.nativeVlan')} hint={t('hints.nativeVlan')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={4094}
                  value={f.nativeVlan}
                  onChange={set('nativeVlan')}
                />
              )}
            </FormField>
            <FormField label={t('devices.allowedVlans')} hint={t('hints.allowedVlans')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={500}
                  value={f.allowedVlans}
                  onChange={set('allowedVlans')}
                  className="font-mono"
                />
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t('devices.ifaceDescription')} className="col-span-1">
              {(p) => (
                <Input {...p} maxLength={200} value={f.description} onChange={set('description')} />
              )}
            </FormField>
            <FormField label={t('devices.mac')} hint={t('hints.mac')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={20}
                  value={f.mac}
                  onChange={set('mac')}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('devices.vlanTag')} hint={t('hints.vlanTag')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={4094}
                  disabled={f.kind !== 'subinterface'}
                  value={f.vlanTag}
                  onChange={set('vlanTag')}
                />
              )}
            </FormField>
          </div>
          <div className="flex gap-6 text-form">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={f.poe}
                onCheckedChange={(on) => setF({ ...f, poe: on === true })}
              />
              {t('devices.poe')}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={f.adminUp}
                onCheckedChange={(on) => setF({ ...f, adminUp: on === true })}
              />
              {t('devices.adminUp')}
            </label>
          </div>
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

/** Interfaces of a device: virtual ones added here, physical ones from a template; one is the management interface. */
export function InterfacesTab({
  orgId,
  device,
  canEdit,
}: {
  orgId: string
  device: Device
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const interfaces = useInterfaces(orgId, device.id)
  const ips = useDeviceIps(orgId, device.id)
  const templates = useTemplates(orgId, canEdit)
  const { remove, apply } = useInterfaceMutations(orgId, device.id)
  const saveDevice = useSaveDevice(orgId)
  const [editing, setEditing] = useState<Interface | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Interface | null>(null)
  const [templateId, setTemplateId] = useState('')

  if (interfaces.isPending) return <Skeleton className="h-32" />
  if (interfaces.isError)
    return (
      <p role="alert" className="text-destructive">
        {interfaces.error.message}
      </p>
    )
  const list = interfaces.data
  const ipsOf = (id: string) => (ips.data ?? []).filter((ip) => ip.interfaceId === id)
  const setMgmt = (i: Interface) =>
    saveDevice.mutate(
      { device, body: { ...deviceToInput(device), mgmtInterfaceId: i.id } },
      {
        onSuccess: () => toast.success(t('devices.mgmtSet', { name: i.name })),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('devices.ifaceAdd')}
          </Button>
          {(templates.data ?? []).length > 0 && (
            <>
              <div className="w-64">
                <NativeSelect
                  aria-label={t('devices.template')}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">{t('devices.template')}…</option>
                  {(templates.data ?? []).map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name} ({t('templates.portCount', { count: tp.portCount })})
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                variant="outline"
                disabled={!templateId || apply.isPending}
                onClick={() =>
                  apply.mutate(templateId, {
                    onSuccess: (n) => toast.success(t('devices.applied', { count: n })),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                {t('devices.applyTemplate')}
              </Button>
            </>
          )}
        </div>
      )}
      {list.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={<Cable />}
            title={t('devices.ifaceEmpty')}
            description={canEdit ? t('devices.ifaceEmptyHint') : undefined}
          />
        </div>
      ) : (
        <PlainTable
          caption={t('devices.tabInterfaces')}
          head={[
            t('devices.ifaceName'),
            t('devices.ifaceKind'),
            t('devices.media'),
            t('devices.speed'),
            t('devices.mode'),
            'VLAN',
            t('devices.lag'),
            'IP',
            'MAC',
            t('devices.ifaceDescription'),
            <span key="a" className="sr-only">
              {t('common.more')}
            </span>,
          ]}
        >
          {list.map((i) => (
            <tr key={i.id} className={i.adminUp ? undefined : 'text-muted-foreground'}>
              <td>
                <span className="inline-flex items-center gap-1.5">
                  <TechText value={i.name} label={t('devices.ifaceName')} copy={false} />
                  {i.isManagement && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 text-label text-primary">
                      <Star aria-hidden className="size-3" /> {t('devices.mgmtBadge')}
                    </span>
                  )}
                </span>
              </td>
              <td>{t(`devices.ifaceKinds.${i.kind}`)}</td>
              <td>{i.media || '—'}</td>
              <td data-numeric>{i.speed || '—'}</td>
              <td>{i.mode || '—'}</td>
              <td className="font-mono text-tech">
                {i.accessVlan ?? ''}
                {i.allowedVlans && `${i.accessVlan ? ' · ' : ''}${i.allowedVlans}`}
                {i.vlanTag && `dot1q ${i.vlanTag}`}
                {!i.accessVlan && !i.allowedVlans && !i.vlanTag && '—'}
              </td>
              <td>{i.lagName || '—'}</td>
              <td className="font-mono text-tech">
                {ipsOf(i.id)
                  .map((ip) => ip.address)
                  .join(', ') || '—'}
              </td>
              <td className="font-mono text-tech">{i.mac || '—'}</td>
              <td className="max-w-64 truncate">{i.description || '—'}</td>
              <td className="text-right">
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('table.rowActions', { name: i.name })}
                        />
                      }
                    >
                      <MoreHorizontal aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => setEditing(i)}>
                        {t('devices.edit')}
                      </DropdownMenuItem>
                      {!i.isManagement && (
                        <DropdownMenuItem onClick={() => setMgmt(i)}>
                          {t('devices.setMgmt')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(i)}>
                        {t('devices.ifaceDelete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </td>
            </tr>
          ))}
        </PlainTable>
      )}
      {editing && (
        <InterfaceDialog
          orgId={orgId}
          device={device}
          iface={editing === 'new' ? undefined : editing}
          interfaces={list}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('devices.ifaceDeleteTitle', { name: deleting?.name ?? '' })}
        description={t('devices.ifaceDeleteBody')}
        confirmLabel={t('devices.ifaceDelete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}

function IpDialog({
  orgId,
  device,
  ip,
  interfaces,
  onClose,
}: {
  orgId: string
  device: Device
  ip?: IpAddress
  interfaces: Interface[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useIpMutations(orgId, device.id)
  const [f, setF] = useState({
    address: ip?.address ?? '',
    interfaceId: ip ? (ip.interfaceId ?? '') : (device.mgmtInterfaceId ?? interfaces[0]?.id ?? ''),
    role: (ip?.role ?? 'primary') as IpRole,
    vrf: ip?.vrf ?? '',
    description: ip?.description ?? '',
  })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        ip,
        body: {
          address: f.address.trim(),
          interfaceId: f.interfaceId || null,
          role: f.role,
          vrf: f.vrf,
          description: f.description,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('devices.saved'))
          onClose()
        },
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={ip ? t('devices.ipEdit', { address: ip.address }) : t('devices.ipAdd')}
        >
          <DialogHeader>
            <DialogTitle>
              {ip ? t('devices.ipEdit', { address: ip.address }) : t('devices.ipAdd')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('devices.address')} required hint={t('hints.cidr')}>
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  value={f.address}
                  onChange={(e) => setF({ ...f, address: e.target.value })}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('devices.ipRole')} hint={t(`hints.ipRoles.${f.role}`)}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.role}
                  onChange={(e) => setF({ ...f, role: e.target.value as IpRole })}
                >
                  {IP_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`devices.ipRoles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.ipInterface')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.interfaceId}
                  onChange={(e) => setF({ ...f, interfaceId: e.target.value })}
                >
                  <option value="">{t('devices.onDevice')}</option>
                  {interfaces.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.vrf')} hint={t('hints.vrf')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={64}
                  value={f.vrf}
                  onChange={(e) => setF({ ...f, vrf: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <FormField label={t('devices.ipDescription')}>
            {(p) => (
              <Input
                {...p}
                maxLength={200}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
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

/** IP addresses of a device: on its interfaces, or NAT/public kept on the device (ADR-012). */
export function IpsTab({
  orgId,
  device,
  canEdit,
}: {
  orgId: string
  device: Device
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const ips = useDeviceIps(orgId, device.id)
  const interfaces = useInterfaces(orgId, device.id)
  const { remove } = useIpMutations(orgId, device.id)
  const [editing, setEditing] = useState<IpAddress | 'new' | null>(null)
  const [deleting, setDeleting] = useState<IpAddress | null>(null)
  if (ips.isPending) return <Skeleton className="h-32" />
  if (ips.isError)
    return (
      <p role="alert" className="text-destructive">
        {ips.error.message}
      </p>
    )
  return (
    <div className="space-y-3">
      {canEdit && (
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden /> {t('devices.ipAdd')}
        </Button>
      )}
      {ips.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<Cable />} title={t('devices.ipEmpty')} />
        </div>
      ) : (
        <PlainTable
          caption={t('devices.tabIps')}
          head={[
            t('devices.address'),
            t('devices.ipInterface'),
            t('devices.ipRole'),
            t('devices.vrf'),
            t('devices.ipDescription'),
            <span key="a" className="sr-only">
              {t('common.more')}
            </span>,
          ]}
        >
          {ips.data.map((ip) => (
            <tr key={ip.id}>
              <td>
                <TechText value={ip.address} label={t('devices.address')} />
              </td>
              <td>{ip.interfaceName || t('devices.onDevice')}</td>
              <td>{t(`devices.ipRoles.${ip.role}`)}</td>
              <td>{ip.vrf || '—'}</td>
              <td>{ip.description || '—'}</td>
              <td className="text-right">
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('table.rowActions', { name: ip.address })}
                        />
                      }
                    >
                      <MoreHorizontal aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => setEditing(ip)}>
                        {t('devices.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(ip)}>
                        {t('devices.ipDelete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </td>
            </tr>
          ))}
        </PlainTable>
      )}
      {editing && (
        <IpDialog
          orgId={orgId}
          device={device}
          ip={editing === 'new' ? undefined : editing}
          interfaces={interfaces.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('devices.ipDeleteTitle', { address: deleting?.address ?? '' })}
        confirmLabel={t('devices.ipDelete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
