import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOrganization } from '@/app/orgs'
import { FieldHelp } from '@/components/FieldHelp'
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
import { locationPath, useLocations, useRacks, useSites } from '@/modules/sites/sites'
import {
  DEVICE_ROLES,
  DEVICE_TYPE_GROUPS,
  LIFECYCLES,
  canJoinCluster,
  CLUSTER_ROLES,
  useClusters,
  useCustomFields,
  useInterfaces,
  useSaveDevice,
  type ClusterRole,
  type CustomField,
  type Device,
  type DeviceInput,
  type DeviceLifecycle,
  type DeviceRole,
  type DeviceType,
} from './devices'
import { TemplatePicker, useTemplateChoices, type ResolvedTemplate } from './TemplatePicker'

type CustomValue = string | number | boolean

/** Guidance for the identity fields rendered in a loop (DESIGN.md §4a). */
const IDENTITY_HELP: Partial<
  Record<string, { guide?: 'partNumber' | 'serial' | 'assetTag' | 'firmware'; help?: string }>
> = {
  partNumber: { guide: 'partNumber', help: 'part-number' },
  serialNumber: { guide: 'serial', help: 'serial' },
  assetTag: { guide: 'assetTag', help: 'asset-tag' },
  firmware: { guide: 'firmware', help: 'firmware' },
}

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
 * Create (device undefined) or edit a device (SRS §4.1). The device's category is its site's (ADR-032). Location
 * and rack lists follow the chosen site; picking a rack fixes the location.
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
  const fields = useCustomFields(orgId)
  const choices = useTemplateChoices(orgId, !device)
  /** The user picked a template by hand: typing a model no longer changes it. */
  const [manualTemplate, setManualTemplate] = useState(false)
  const clusters = useClusters(orgId)
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
    locationId: device?.locationId ?? '',
    rackId: device?.rackId ?? '',
    rackU: device?.rackU ? String(device.rackU) : '',
    uHeight: String(device?.uHeight ?? 1),
    templateId: '',
    mgmtInterfaceId: device?.mgmtInterfaceId ?? '',
    pollAddress: device?.pollAddress ?? '',
    clusterId: device?.clusterId ?? '',
    clusterRole: (device?.clusterRole ?? '') as ClusterRole | '',
    clusterMemberNo: device?.clusterMemberNo ? String(device.clusterMemberNo) : '',
  })
  const [custom, setCustom] = useState<Record<string, CustomValue>>(
    (device?.customFields ?? {}) as Record<string, CustomValue>,
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const picked = choices.resolve(f.templateId)
  /**
   * A template sets the type and size, and the vendor when it is still empty; a library model also fills empty
   * end-of-sale / end-of-support dates (P2-22).
   */
  const applyTemplate = (next: typeof f, tpl: ResolvedTemplate | null): typeof f =>
    tpl
      ? {
          ...next,
          type: tpl.type,
          uHeight: String(tpl.uHeight),
          vendor: next.vendor || tpl.vendor,
          eolDate: next.eolDate || tpl.endOfSale,
          eosDate: next.eosDate || tpl.endOfSupport,
        }
      : next
  const site = sites.data?.find((s) => s.id === f.siteId)
  const locations = useLocations(orgId, f.siteId)
  const racks = useRacks(orgId, f.siteId)
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
      locationId: f.locationId || null,
      rackId: f.rackId || null,
      rackU: f.rackId && f.rackU ? Number(f.rackU) : null,
      uHeight: Number(f.uHeight) || 1,
      templateId: !device && f.templateId.startsWith('org:') ? f.templateId.slice(4) : null,
      ...(!device && f.templateId.startsWith('sys:') ? { catalogId: f.templateId.slice(4) } : {}),
      mgmtInterfaceId: f.mgmtInterfaceId || null,
      pollAddress: f.pollAddress.trim() || null,
      clusterId: f.clusterId || null,
      clusterRole: f.clusterId && f.clusterRole ? f.clusterRole : null,
      clusterMemberNo: f.clusterId && f.clusterMemberNo ? Number(f.clusterMemberNo) : null,
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
            {!device && (
              <FormField
                label={t('devices.template')}
                guide={t('devices.templateHint')}
                hint={
                  picked
                    ? t(picked.kind === 'sys' ? 'templates.pickedSystem' : 'templates.pickedOwn', {
                        name: picked.label,
                        count: picked.portCount,
                      }) + (picked.verified ? '' : ` ${t('deviceImport.catalogUnverified')}`)
                    : undefined
                }
                help="template"
                className="col-span-3"
              >
                {(p) => (
                  <TemplatePicker
                    {...p}
                    choices={choices}
                    noneLabel={t('devices.noTemplate')}
                    value={f.templateId}
                    onChange={(e) => {
                      setManualTemplate(true)
                      setF(
                        applyTemplate(
                          { ...f, templateId: e.target.value },
                          choices.resolve(e.target.value),
                        ),
                      )
                    }}
                  />
                )}
              </FormField>
            )}
            <FormField
              label={t('devices.hostname')}
              guide={t('guides.hostname')}
              help="hostname"
              required
              className="col-span-2"
            >
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
            <FormField label={t('devices.type')} guide={t('guides.type')} required>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.type}
                  onChange={(e) => setF({ ...f, type: e.target.value as DeviceType })}
                >
                  {DEVICE_TYPE_GROUPS.map((g) => (
                    <optgroup key={g.group} label={t(`devices.typeGroups.${g.group}`)}>
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
              <FormField
                key={k}
                label={t(`devices.${label}`)}
                guide={IDENTITY_HELP[k]?.guide && t(`guides.${IDENTITY_HELP[k].guide}`)}
                help={IDENTITY_HELP[k]?.help}
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={100}
                    value={f[k]}
                    onChange={(e) => {
                      const next = { ...f, [k]: e.target.value }
                      // A known model / part number picks its template (ports, size) unless one was chosen by hand.
                      if (!device && !manualTemplate && (k === 'model' || k === 'partNumber')) {
                        const choice = choices.match([next.partNumber, next.model], next.type)
                        setF(
                          applyTemplate(
                            { ...next, templateId: choice ?? '' },
                            choices.resolve(choice),
                          ),
                        )
                      } else setF(next)
                    }}
                  />
                )}
              </FormField>
            ))}
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupPlace')}</legend>
            <FormField label={t('devices.site')} guide={t('guides.site')} help="site" required>
              {(p) => (
                <NativeSelect
                  {...p}
                  required
                  value={f.siteId}
                  onChange={(e) =>
                    setF({
                      ...f,
                      siteId: e.target.value,
                      locationId: '',
                      rackId: '',
                      rackU: '',
                      clusterId: '',
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
            {site && (
              <p className="col-span-2 -mt-1 text-muted-foreground">
                {t('devices.categoryOfSite', {
                  category: site.categoryPath || t('categories.orgShort'),
                })}
              </p>
            )}
            <FormField label={t('devices.location')} guide={t('guides.location')} help="location">
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
            <FormField label={t('devices.rack')} help="rack-u">
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
              <FormField label={t('devices.rackU')} guide={t('guides.rackU')} help="rack-u">
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
              <FormField label={t('devices.uHeight')} guide={t('guides.uHeight')}>
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
            <legend className={legend}>{t('clusters.cluster')}</legend>
            <FormField label={t('clusters.cluster')} help="cluster" hint={t('clusters.deviceHint')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.clusterId}
                  disabled={!f.siteId}
                  onChange={set('clusterId')}
                >
                  <option value="">{t('clusters.noCluster')}</option>
                  {(clusters.data ?? [])
                    .filter(
                      (c) =>
                        c.siteId === f.siteId &&
                        (c.id === device?.clusterId || canJoinCluster(c, f.type)),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({t(`clusters.kinds.${c.kind}`)})
                      </option>
                    ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('clusters.role')} guide={t('guides.clusterRole')} help="ha">
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.clusterRole}
                  disabled={!f.clusterId}
                  onChange={(e) => setF({ ...f, clusterRole: e.target.value as ClusterRole | '' })}
                >
                  <option value="">—</option>
                  {CLUSTER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`clusters.roles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('clusters.memberNo')} guide={t('guides.memberNo')} help="member-no">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={99}
                  disabled={!f.clusterId}
                  value={f.clusterMemberNo}
                  onChange={set('clusterMemberNo')}
                />
              )}
            </FormField>
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className={legend}>{t('devices.groupOps')}</legend>
            <FormField
              label={t('devices.lifecycle')}
              guide={t('guides.lifecycle')}
              help="lifecycle"
            >
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
            <FormField label={t('devices.role')} guide={t('guides.role')} help="role">
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
            <FormField label={t('devices.owner')} guide={t('guides.owner')}>
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
                <FieldHelp term="managed" />
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
              <FormField
                key={k}
                label={t(`devices.${label}`)}
                help={k === 'eolDate' || k === 'eosDate' ? 'eol' : undefined}
              >
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
              <FormField
                label={t('devices.mgmtInterface')}
                help="mgmt-ip"
                guide={t('devices.mgmtHint')}
              >
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
              <FormField
                label={t('devices.pollAddress')}
                help="poll-address"
                guide={t('devices.pollHint')}
              >
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
