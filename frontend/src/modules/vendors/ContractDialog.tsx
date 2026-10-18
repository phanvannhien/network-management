import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fetchDevicePage } from '@/modules/inventory/devices'
import { useLinks } from '@/modules/inventory/links'
import { VendorDialog } from './VendorDialogs'
import {
  CONTRACT_KINDS,
  useContractMutations,
  useVendors,
  type ContractDetail,
  type ContractKind,
} from './vendors'

interface Picked {
  id: string
  hostname: string
}

/**
 * Add / edit a contract (P2-04): vendor, kind, dates, what it covers (devices, and the links of those devices — a
 * WAN line for an internet contract). One contract = one service with its own end date.
 */
export function ContractDialog({
  orgId,
  detail,
  initialDevices = [],
  vendorId,
  onClose,
  onSaved,
}: {
  orgId: string
  detail?: ContractDetail
  /** New contract from a device page: it starts covering that device. */
  initialDevices?: Picked[]
  vendorId?: string
  onClose: () => void
  onSaved?: (d: ContractDetail) => void
}) {
  const { t } = useTranslation()
  const vendors = useVendors(orgId)
  const { save } = useContractMutations(orgId)
  const k = detail?.contract
  const [f, setF] = useState({
    vendorId: k?.vendorId ?? vendorId ?? '',
    kind: k?.kind ?? ('support' as ContractKind),
    name: k?.name ?? '',
    number: k?.number ?? '',
    startDate: k?.startDate ?? '',
    endDate: k?.endDate ?? '',
    sla: k?.sla ?? '',
    notes: k?.notes ?? '',
  })
  const [devices, setDevices] = useState<Picked[]>(
    detail ? detail.devices.map((d) => ({ id: d.id, hostname: d.hostname })) : initialDevices,
  )
  const [links, setLinks] = useState<string[]>(detail?.links.map((l) => l.id) ?? [])
  // How each chosen link reads ("FW1 ↔ ONT · FPT"), so every chosen link stays visible and removable.
  const [linkLabels, setLinkLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (detail?.links ?? []).map((l) => [
        l.id,
        [`${l.aName} ↔ ${l.bName}`, l.provider, l.circuitId].filter(Boolean).join(' · '),
      ]),
    ),
  )
  const [search, setSearch] = useState('')
  const [addingVendor, setAddingVendor] = useState(false)
  const found = useQuery({
    queryKey: ['orgs', orgId, 'devices', 'contract-pick', search.trim()],
    enabled: search.trim().length >= 2,
    queryFn: () =>
      fetchDevicePage(orgId, {
        q: search.trim(),
        facets: {},
        categoryId: null,
        sort: null,
        pageIndex: 0,
        pageSize: 10,
      }),
  })
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [key]: e.target.value })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: k?.id,
        body: {
          ...f,
          startDate: f.startDate || null,
          endDate: f.endDate || null,
          deviceIds: devices.map((d) => d.id),
          linkIds: links,
          ...(k ? { version: k.version } : {}),
        },
      },
      {
        onSuccess: (d) => {
          toast.success(t('contracts.saved'))
          if (d) onSaved?.(d)
          onClose()
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{k ? t('contracts.edit') : t('contracts.add')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          id="contract-form"
          className="max-h-[65vh] space-y-3 overflow-y-auto pr-1"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField className="sm:col-span-2" label={t('contracts.vendor')} required>
              {(p) => (
                <div className="flex gap-2">
                  <NativeSelect {...p} required value={f.vendorId} onChange={set('vendorId')}>
                    <option value="">{t('contracts.pickVendor')}</option>
                    {(vendors.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="outline" onClick={() => setAddingVendor(true)}>
                    <Plus aria-hidden /> {t('vendors.addShort')}
                  </Button>
                </div>
              )}
            </FormField>
            <FormField label={t('contracts.kind')} guide={t(`contracts.kindGuides.${f.kind}`)}>
              {(p) => (
                <NativeSelect {...p} value={f.kind} onChange={set('kind')}>
                  {CONTRACT_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {t(`contracts.kinds.${x}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              className="sm:col-span-2"
              label={t('contracts.name')}
              guide={t('contracts.nameGuide')}
              required
            >
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
            <FormField label={t('contracts.number')}>
              {(p) => <Input {...p} maxLength={100} value={f.number} onChange={set('number')} />}
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('contracts.startDate')}>
              {(p) => <Input {...p} type="date" value={f.startDate} onChange={set('startDate')} />}
            </FormField>
            <FormField label={t('contracts.endDate')} guide={t('contracts.endDateGuide')}>
              {(p) => <Input {...p} type="date" value={f.endDate} onChange={set('endDate')} />}
            </FormField>
          </div>
          <FormField label={t('contracts.sla')} guide={t('contracts.slaGuide')} help="sla">
            {(p) => (
              <Input
                {...p}
                maxLength={500}
                placeholder={t('contracts.slaPlaceholder')}
                value={f.sla}
                onChange={set('sla')}
              />
            )}
          </FormField>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('contracts.devices')}</legend>
            <p className="text-xs text-muted-foreground">{t('contracts.devicesGuide')}</p>
            <div className="flex flex-wrap gap-1">
              {devices.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-xs"
                >
                  {d.hostname}
                  <button
                    type="button"
                    aria-label={t('contracts.removeDevice', { name: d.hostname })}
                    onClick={() => setDevices(devices.filter((x) => x.id !== d.id))}
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              aria-label={t('contracts.searchDevice')}
              placeholder={t('contracts.searchDevice')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim().length >= 2 && (
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {(found.data?.devices ?? [])
                  .filter((d) => !devices.some((x) => x.id === d.id))
                  .map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setDevices([...devices, { id: d.id, hostname: d.hostname }])
                          setSearch('')
                        }}
                      >
                        <Plus aria-hidden className="size-3.5" />
                        <span className="font-mono">{d.hostname}</span>
                        <span className="text-muted-foreground">
                          {d.siteCode} · {d.model}
                        </span>
                      </button>
                    </li>
                  ))}
                {found.data && found.data.devices.length === 0 && (
                  <li className="px-2 py-1 text-sm text-muted-foreground">
                    {t('contracts.noDeviceFound')}
                  </li>
                )}
              </ul>
            )}
          </fieldset>
          {(devices.length > 0 || links.length > 0) && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('contracts.links')}</legend>
              <p className="text-xs text-muted-foreground">{t('contracts.linksGuide')}</p>
              <div className="flex flex-wrap gap-1">
                {links.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
                  >
                    {linkLabels[id] ?? t('contracts.linkUnknown')}
                    <button
                      type="button"
                      aria-label={t('contracts.removeLink', { name: linkLabels[id] ?? '' })}
                      onClick={() => setLinks(links.filter((x) => x !== id))}
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              {devices.map((d) => (
                <DeviceLinks
                  key={d.id}
                  orgId={orgId}
                  device={d}
                  picked={links}
                  onAdd={(id, label) => {
                    setLinks((x) => [...x, id])
                    setLinkLabels((x) => ({ ...x, [id]: label }))
                  }}
                />
              ))}
            </fieldset>
          )}
          <FormField label={t('vendors.notes')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={4000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="contract-form" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
        {addingVendor && (
          <VendorDialog
            orgId={orgId}
            onClose={() => setAddingVendor(false)}
            onSaved={(v) => setF((x) => ({ ...x, vendorId: v.id }))}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The links of one chosen device not chosen yet, to add the ones the contract covers. */
function DeviceLinks({
  orgId,
  device,
  picked,
  onAdd,
}: {
  orgId: string
  device: Picked
  picked: string[]
  onAdd: (id: string, label: string) => void
}) {
  const { t } = useTranslation()
  const links = useLinks(orgId, device.id)
  const open = (links.data ?? []).filter((l) => !picked.includes(l.id))
  if (open.length === 0) return null
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-xs text-muted-foreground">{device.hostname}</p>
      {open.map((l) => {
        const other = l.a.id === device.id ? l.b : l.a
        const label = [`${device.hostname} ↔ ${other.name}`, l.provider, l.circuitId]
          .filter(Boolean)
          .join(' · ')
        return (
          <button
            key={l.id}
            type="button"
            className="flex items-center gap-1.5 text-left text-sm hover:underline"
            onClick={() => onAdd(l.id, label)}
          >
            <Plus aria-hidden className="size-3.5" />↔ {other.name}
            {l.provider && ` · ${l.provider}`}
            {l.circuitId && ` · ${t('contracts.circuit', { id: l.circuitId })}`}
          </button>
        )
      })}
    </div>
  )
}
