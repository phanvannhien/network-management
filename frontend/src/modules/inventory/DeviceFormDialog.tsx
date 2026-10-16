import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOrganization } from '@/app/orgs'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { atLeast } from '@/modules/sites/access'
import {
  locationPath,
  useBusinessUnits,
  useLocations,
  useRacks,
  useSites,
} from '@/modules/sites/sites'
import {
  DEVICE_ROLES,
  DEVICE_TYPE_GROUPS,
  LIFECYCLES,
  useCustomFields,
  useInterfaces,
  useTemplates,
  useSaveDevice,
  type CustomField,
  type Device,
  type DeviceInput,
  type DeviceLifecycle,
  type DeviceRole,
  type DeviceType,
} from './devices'

type CustomValue = string | number | boolean

/** One custom field control by kind (values are sent as JSON: text/date/select strings, numbers, booleans). */
function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomField
  value: CustomValue | undefined
  onChange: (v: CustomValue | undefined) => void
}) {
  const { t } = useTranslation()
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 pt-6 text-form">
        <Checkbox checked={value === true} onCheckedChange={(on) => onChange(on === true)} />
        {field.label}
      </label>
    )
  }
  return (
    <FormField label={field.label} required={field.required}>
      {(p) =>
        field.kind === 'select' ? (
          <NativeSelect
            {...p}
            required={field.required}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <option value="">{t('devices.noLocation')}</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input
            {...p}
            required={field.required}
            type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
            maxLength={1000}
            value={value === undefined || typeof value === 'boolean' ? '' : String(value)}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') onChange(undefined)
              else onChange(field.kind === 'number' ? Number(v) : v)
            }}
          />
        )
      }
    </FormField>
  )
}

/**
 * Create (device undefined) or edit a device (SRS §4.1). In a unit's site the device belongs to that unit; in a
 * shared site the owner unit is chosen among units the caller may edit (ADR-026/031). Location and rack lists
 * follow the chosen site; picking a rack fixes the location.
 */
export function DeviceFormDialog({
  orgId,
  device,
  defaultSiteId,
  onClose,
  onSaved,
}: {
  orgId: string
  device?: Device
  defaultSiteId?: string
  onClose: () => void
  onSaved?: (d: Device) => void
}) {
  const { t } = useTranslation()
  const save = useSaveDevice(orgId)
  const orgName = useOrganization(orgId).data?.organization.name ?? ''
  const sites = useSites(orgId)
  const units = useBusinessUnits(orgId)
  const fields = useCustomFields(orgId)
  const templates = useTemplates(orgId, !device)
  const interfaces = useInterfaces(orgId, device?.id ?? '', Boolean(device))
  const [f, setF] = useState({
    hostname: device?.hostname ?? '',
    type: (device?.type ?? 'l2_switch') as DeviceType,
    vendor: device?.vendor ?? '',
    model: device?.model ?? '',
    partNumber: device?.partNumber ?? '',
    serialNumber: device?.serialNumber ?? '',
    assetTag: device?.assetTag ?? '',
    firmware: device?.firmware ?? '',
    role: (device?.role ?? 'none') as DeviceRole,
    lifecycle: (device?.lifecycle ?? 'active') as DeviceLifecycle,
    managed: device?.managed ?? true,
    ownerName: device?.ownerName ?? '',
    poNumber: device?.poNumber ?? '',
    purchaseDate: device?.purchaseDate ?? '',
    warrantyEnd: device?.warrantyEnd ?? '',
    licenseEnd: device?.licenseEnd ?? '',
    eolDate: device?.eolDate ?? '',
    eosDate: device?.eosDate ?? '',
    notes: device?.notes ?? '',
    tags: (device?.tags ?? []).join(', '),
    siteId: device?.siteId ?? defaultSiteId ?? '',
    businessUnitId: device?.businessUnitId ?? '',
    locationId: device?.locationId ?? '',
    rackId: device?.rackId ?? '',
    rackU: device?.rackU ? String(device.rackU) : '',
    uHeight: String(device?.uHeight ?? 1),
    templateId: '',
    mgmtInterfaceId: device?.mgmtInterfaceId ?? '',
    pollAddress: device?.pollAddress ?? '',
  })
  const [custom, setCustom] = useState<Record<string, CustomValue>>(
    (device?.customFields ?? {}) as Record<string, CustomValue>,
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const site = sites.data?.find((s) => s.id === f.siteId)
  const locations = useLocations(orgId, f.siteId)
  const racks = useRacks(orgId, f.siteId)
  const shared = site !== undefined && site.businessUnitId === null
  // Owner units for a shared site: those the caller edits, plus the device's current one.
  const ownerUnits = (units.data ?? []).filter(
    (u) => atLeast(u.access, 'edit') || u.id === device?.businessUnitId,
  )
  const rackList = (racks.data ?? []).filter((r) => !f.locationId || r.locationId === f.locationId)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const date = (v: string) => (v === '' ? null : v)
    const body: DeviceInput = {
      hostname: f.hostname.trim(),
      type: f.type,
      vendor: f.vendor,
      model: f.model,
      partNumber: f.partNumber,
      serialNumber: f.serialNumber,
      assetTag: f.assetTag,
      firmware: f.firmware,
      role: f.role,
      lifecycle: f.lifecycle,
      managed: f.managed,
      ownerName: f.ownerName,
      poNumber: f.poNumber,
      purchaseDate: date(f.purchaseDate),
      warrantyEnd: date(f.warrantyEnd),
      licenseEnd: date(f.licenseEnd),
      eolDate: date(f.eolDate),
      eosDate: date(f.eosDate),
      notes: f.notes,
      tags: f.tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      customFields: custom,
      siteId: f.siteId,
      businessUnitId: shared ? f.businessUnitId || null : null,
      locationId: f.locationId || null,
      rackId: f.rackId || null,
      rackU: f.rackId && f.rackU ? Number(f.rackU) : null,
      uHeight: Number(f.uHeight) || 1,
      templateId: device ? null : f.templateId || null,
      mgmtInterfaceId: f.mgmtInterfaceId || null,
      pollAddress: f.pollAddress.trim() || null,
    }
    save.mutate(
      { device, body },
      {
        onSuccess: (saved) => {
          toast.success(
            device ? t('devices.saved') : t('devices.created', { name: saved.hostname }),
          )
          onSaved?.(saved)
          onClose()
        },
      },
    )
  }

  const legend = 'mb-1 text-form font-medium'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form
          onSubmit={onSubmit}
          className="space-y-5"
          aria-label={device ? t('devices.edit') : t('devices.add')}
        >
          <DialogHeader>
            <DialogTitle>
              {device
                ? t('devices.editTitle', { name: device.hostname })
                : t('devices.addTitle', { org: orgName })}
            </DialogTitle>
          </DialogHeader>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupIdentity')}</legend>
            {!device && (templates.data ?? []).length > 0 && (
              <FormField
                label={t('devices.template')}
                hint={t('devices.templateHint')}
                className="col-span-3"
              >
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={f.templateId}
                    onChange={(e) => {
                      const tp = templates.data?.find((x) => x.id === e.target.value)
                      setF({
                        ...f,
                        templateId: e.target.value,
                        type: tp ? tp.type : f.type,
                        uHeight: tp ? String(tp.uHeight) : f.uHeight,
                      })
                    }}
                  >
                    <option value="">{t('devices.noTemplate')}</option>
                    {(templates.data ?? []).map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.name} ({t('templates.portCount', { count: tp.portCount })})
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
            <FormField label={t('devices.hostname')} required className="col-span-2">
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={253}
                  value={f.hostname}
                  onChange={set('hostname')}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('devices.type')} required>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.type}
                  onChange={(e) => setF({ ...f, type: e.target.value as DeviceType })}
                >
                  {DEVICE_TYPE_GROUPS.map((g) => (
                    <optgroup key={g.group} label={t(`devices.typeGroups.${g.group as 'other'}`)}>
                      {g.types.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`devices.types.${ty}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {(
              [
                ['vendor', 'vendor'],
                ['model', 'model'],
                ['partNumber', 'partNumber'],
                ['serialNumber', 'serial'],
                ['assetTag', 'assetTag'],
                ['firmware', 'firmware'],
              ] as const
            ).map(([k, label]) => (
              <FormField key={k} label={t(`devices.${label}`)}>
                {(p) => <Input {...p} maxLength={100} value={f[k]} onChange={set(k)} />}
              </FormField>
            ))}
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupPlace')}</legend>
            <FormField label={t('devices.site')} required>
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
                      locationId: '',
                      rackId: '',
                      rackU: '',
                    })
                  }
                >
                  <option value="">{t('devices.chooseSite')}</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              label={t('devices.unit')}
              required={shared}
              hint={shared ? t('devices.sharedSiteUnit') : undefined}
              className="col-span-2"
            >
              {(p) =>
                shared ? (
                  <NativeSelect
                    {...p}
                    required
                    value={f.businessUnitId}
                    onChange={set('businessUnitId')}
                  >
                    <option value="">{t('devices.chooseUnit')}</option>
                    {ownerUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.partnerCode} › {u.code} · {u.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    {...p}
                    readOnly
                    value={
                      site
                        ? t('devices.unitOfSite', {
                            unit: `${site.partnerCode} › ${site.businessUnitCode} · ${site.businessUnitName}`,
                          })
                        : ''
                    }
                  />
                )
              }
            </FormField>
            <FormField label={t('devices.location')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.locationId}
                  disabled={!f.siteId}
                  onChange={(e) =>
                    setF({ ...f, locationId: e.target.value, rackId: '', rackU: '' })
                  }
                >
                  <option value="">{t('devices.noLocation')}</option>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {locationPath(locations.data ?? [], l.id)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.rack')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.rackId}
                  disabled={!f.siteId}
                  onChange={(e) => {
                    const rack = racks.data?.find((r) => r.id === e.target.value)
                    setF({
                      ...f,
                      rackId: e.target.value,
                      locationId: rack ? rack.locationId : f.locationId,
                      rackU: rack ? f.rackU : '',
                    })
                  }}
                >
                  <option value="">{t('devices.noRack')}</option>
                  {rackList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.uHeight}U)
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('devices.rackU')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={60}
                    disabled={!f.rackId}
                    value={f.rackU}
                    onChange={set('rackU')}
                  />
                )}
              </FormField>
              <FormField label={t('devices.uHeight')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={60}
                    value={f.uHeight}
                    onChange={set('uHeight')}
                  />
                )}
              </FormField>
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupOps')}</legend>
            <FormField label={t('devices.lifecycle')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.lifecycle}
                  onChange={(e) => setF({ ...f, lifecycle: e.target.value as DeviceLifecycle })}
                >
                  {LIFECYCLES.map((l) => (
                    <option key={l} value={l}>
                      {t(`devices.lifecycleValues.${l}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.role')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.role}
                  onChange={(e) => setF({ ...f, role: e.target.value as DeviceRole })}
                >
                  {DEVICE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`devices.roleValues.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.owner')}>
              {(p) => (
                <Input {...p} maxLength={200} value={f.ownerName} onChange={set('ownerName')} />
              )}
            </FormField>
            <FormField
              label={t('devices.tags')}
              hint={t('devices.tagsHint')}
              className="col-span-2"
            >
              {(p) => <Input {...p} value={f.tags} onChange={set('tags')} />}
            </FormField>
            <label className="flex items-start gap-2 pt-6 text-form">
              <Checkbox
                checked={f.managed}
                onCheckedChange={(on) => setF({ ...f, managed: on === true })}
                aria-describedby="device-managed-hint"
              />
              <span>
                {t('devices.managed')}
                <span id="device-managed-hint" className="block text-label text-muted-foreground">
                  {t('devices.managedHint')}
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupSupport')}</legend>
            {(
              [
                ['purchaseDate', 'purchaseDate'],
                ['warrantyEnd', 'warranty'],
                ['licenseEnd', 'licenseEnd'],
                ['eolDate', 'eolDate'],
                ['eosDate', 'eosDate'],
              ] as const
            ).map(([k, label]) => (
              <FormField key={k} label={t(`devices.${label}`)}>
                {(p) => <Input {...p} type="date" value={f[k]} onChange={set(k)} />}
              </FormField>
            ))}
            <FormField label={t('devices.poNumber')}>
              {(p) => (
                <Input {...p} maxLength={100} value={f.poNumber} onChange={set('poNumber')} />
              )}
            </FormField>
          </fieldset>

          {device && (
            <fieldset className="grid grid-cols-3 gap-3">
              <legend className={legend}>{t('devices.mgmtInterface')}</legend>
              <FormField label={t('devices.mgmtInterface')} hint={t('devices.mgmtHint')}>
                {(p) => (
                  <NativeSelect {...p} value={f.mgmtInterfaceId} onChange={set('mgmtInterfaceId')}>
                    <option value="">{t('devices.noMgmt')}</option>
                    {(interfaces.data ?? []).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label={t('devices.pollAddress')} hint={t('devices.pollHint')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={45}
                    value={f.pollAddress}
                    onChange={set('pollAddress')}
                    className="font-mono"
                  />
                )}
              </FormField>
            </fieldset>
          )}

          {(fields.data ?? []).length > 0 && (
            <fieldset className="grid grid-cols-3 gap-3">
              <legend className={legend}>{t('devices.groupCustom')}</legend>
              {(fields.data ?? []).map((cf) => (
                <CustomFieldInput
                  key={cf.id}
                  field={cf}
                  value={custom[cf.key]}
                  onChange={(v) => {
                    const next = { ...custom }
                    if (v === undefined) delete next[cf.key]
                    else next[cf.key] = v
                    setCustom(next)
                  }}
                />
              ))}
            </fieldset>
          )}

          <FormField label={t('devices.notes')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={4000} value={f.notes} onChange={set('notes')} />
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
            <Button type="submit" disabled={save.isPending || !f.siteId}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
