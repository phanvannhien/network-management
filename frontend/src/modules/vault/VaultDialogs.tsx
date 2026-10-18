import { Eye, EyeOff } from 'lucide-react'
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
import { useVendors } from '@/modules/vendors/vendors'
import { DevicePicker, type PickedDevice } from './DevicePicker'
import {
  CLOUD_PROVIDERS,
  CREDENTIAL_KINDS,
  useCloudMutations,
  useCredentialMutations,
  type CloudAccountDetail,
  type CloudProvider,
  type CredentialDetail,
  type CredentialKind,
} from './vault'

/**
 * Secret input of a form: on a new entry it is the secret; on an existing one, empty keeps the stored secret,
 * "remove" erases it. The stored value is never loaded into the form.
 */
function SecretInput({
  label,
  guide,
  stored,
  value,
  remove,
  onValue,
  onRemove,
}: {
  label: string
  guide: string
  stored: boolean
  value: string
  remove: boolean
  onValue: (v: string) => void
  onRemove: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <FormField label={label} guide={stored ? t('vault.secretKept') : guide}>
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            type={visible ? 'text' : 'password'}
            // Device passwords belong in the vault, not in the browser's password manager under this site.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            maxLength={2000}
            disabled={remove}
            placeholder={stored ? '••••••••' : ''}
            value={value}
            onChange={(e) => onValue(e.target.value)}
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={visible ? t('vault.hideTyped') : t('vault.showTyped')}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
          {stored && (
            <Button
              type="button"
              variant="outline"
              aria-pressed={remove}
              onClick={() => onRemove(!remove)}
            >
              {remove ? t('vault.keepSecret') : t('vault.removeSecret')}
            </Button>
          )}
        </div>
      )}
    </FormField>
  )
}

/** Add / edit a device credential (P2-02). */
export function CredentialDialog({
  orgId,
  detail,
  initialDevices = [],
  onClose,
}: {
  orgId: string
  detail?: CredentialDetail
  initialDevices?: PickedDevice[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useCredentialMutations(orgId)
  const c = detail?.credential
  const [f, setF] = useState({
    name: c?.name ?? '',
    kind: c?.kind ?? ('ssh' as CredentialKind),
    username: c?.username ?? '',
    rotateDays: c?.rotateDays ? String(c.rotateDays) : '',
    lastRotatedOn: c?.lastRotatedOn ?? '',
    notes: c?.notes ?? '',
  })
  const [secret, setSecret] = useState('')
  const [remove, setRemove] = useState(false)
  const [devices, setDevices] = useState<PickedDevice[]>(
    detail
      ? detail.devices.map((d) => ({ id: d.deviceId, hostname: d.hostname, purpose: d.purpose }))
      : initialDevices,
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: c?.id,
        body: {
          name: f.name,
          kind: f.kind,
          username: f.username,
          notes: f.notes,
          rotateDays: f.rotateDays ? Number(f.rotateDays) : null,
          lastRotatedOn: f.lastRotatedOn || null,
          devices: devices.map((d) => ({ deviceId: d.id, purpose: d.purpose ?? '' })),
          // Omitted = keep; empty = remove; a value = new secret.
          ...(remove ? { secret: '' } : secret ? { secret } : {}),
          ...(c ? { version: c.version } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(t('vault.saved'))
          onClose()
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c ? t('vault.editCredential') : t('vault.addCredential')}</DialogTitle>
        </DialogHeader>
        <form
          id="credential-form"
          onSubmit={onSubmit}
          className="max-h-[65vh] space-y-3 overflow-y-auto pr-1"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              className="sm:col-span-2"
              label={t('vault.name')}
              guide={t('vault.nameGuide')}
              required
            >
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
            <FormField label={t('vault.kind')} guide={t(`vault.kindGuides.${f.kind}`)}>
              {(p) => (
                <NativeSelect {...p} value={f.kind} onChange={set('kind')}>
                  {CREDENTIAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vault.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('vault.username')} guide={t('vault.usernameGuide')}>
              {(p) => (
                <Input
                  {...p}
                  autoComplete="off"
                  maxLength={200}
                  value={f.username}
                  onChange={set('username')}
                />
              )}
            </FormField>
            <SecretInput
              label={f.kind === 'snmp' ? t('vault.community') : t('vault.secret')}
              guide={f.kind === 'snmp' ? t('vault.communityGuide') : t('vault.secretGuide')}
              stored={c?.hasSecret ?? false}
              value={secret}
              remove={remove}
              onValue={setSecret}
              onRemove={setRemove}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('vault.rotateDays')}
              guide={t('vault.rotateDaysGuide')}
              help="credential"
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="90"
                  value={f.rotateDays}
                  onChange={set('rotateDays')}
                />
              )}
            </FormField>
            <FormField label={t('vault.lastRotatedOn')} guide={t('vault.lastRotatedOnGuide')}>
              {(p) => (
                <Input {...p} type="date" value={f.lastRotatedOn} onChange={set('lastRotatedOn')} />
              )}
            </FormField>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('vault.devices')}</legend>
            <p className="text-xs text-muted-foreground">{t('vault.devicesGuide')}</p>
            <DevicePicker orgId={orgId} value={devices} onChange={setDevices} purposes />
          </fieldset>
          <FormField label={t('vendors.notes')} guide={t('vault.notesGuide')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={4000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="credential-form" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Add / edit a cloud management account (P2-03). */
export function CloudDialog({
  orgId,
  detail,
  initialDevices = [],
  onClose,
}: {
  orgId: string
  detail?: CloudAccountDetail
  initialDevices?: PickedDevice[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useCloudMutations(orgId)
  const vendors = useVendors(orgId)
  const a = detail?.account
  const [f, setF] = useState({
    provider: a?.provider ?? ('forticloud' as CloudProvider),
    name: a?.name ?? '',
    portalUrl: a?.portalUrl ?? '',
    username: a?.username ?? '',
    mfaHolder: a?.mfaHolder ?? '',
    plan: a?.plan ?? '',
    expiresOn: a?.expiresOn ?? '',
    vendorId: a?.vendorId ?? '',
    notes: a?.notes ?? '',
  })
  const [secret, setSecret] = useState('')
  const [remove, setRemove] = useState(false)
  const [devices, setDevices] = useState<PickedDevice[]>(
    detail ? detail.devices.map((d) => ({ id: d.deviceId, hostname: d.hostname })) : initialDevices,
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: a?.id,
        body: {
          ...f,
          expiresOn: f.expiresOn || null,
          vendorId: f.vendorId || null,
          deviceIds: devices.map((d) => d.id),
          ...(remove ? { secret: '' } : secret ? { secret } : {}),
          ...(a ? { version: a.version } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(t('vault.saved'))
          onClose()
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{a ? t('vault.editCloud') : t('vault.addCloud')}</DialogTitle>
        </DialogHeader>
        <form
          id="cloud-form"
          onSubmit={onSubmit}
          className="max-h-[65vh] space-y-3 overflow-y-auto pr-1"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t('vault.provider')} guide={t('vault.providerGuide')}>
              {(p) => (
                <NativeSelect {...p} value={f.provider} onChange={set('provider')}>
                  {CLOUD_PROVIDERS.map((x) => (
                    <option key={x} value={x}>
                      {t(`vault.providers.${x}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              className="sm:col-span-2"
              label={t('vault.name')}
              guide={t('vault.cloudNameGuide')}
              required
            >
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
          </div>
          <FormField label={t('vault.portalUrl')}>
            {(p) => (
              <Input
                {...p}
                type="url"
                maxLength={300}
                placeholder="https://"
                value={f.portalUrl}
                onChange={set('portalUrl')}
              />
            )}
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('vault.username')}>
              {(p) => (
                <Input
                  {...p}
                  autoComplete="off"
                  maxLength={320}
                  value={f.username}
                  onChange={set('username')}
                />
              )}
            </FormField>
            <SecretInput
              label={t('vault.secret')}
              guide={t('vault.secretGuide')}
              stored={a?.hasSecret ?? false}
              value={secret}
              remove={remove}
              onValue={setSecret}
              onRemove={setRemove}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('vault.mfaHolder')}
              guide={t('vault.mfaHolderGuide')}
              help="mfa-holder"
            >
              {(p) => (
                <Input
                  {...p}
                  maxLength={200}
                  placeholder={t('vault.mfaHolderPlaceholder')}
                  value={f.mfaHolder}
                  onChange={set('mfaHolder')}
                />
              )}
            </FormField>
            <FormField label={t('vault.plan')} guide={t('vault.planGuide')}>
              {(p) => <Input {...p} maxLength={200} value={f.plan} onChange={set('plan')} />}
            </FormField>
            <FormField label={t('vault.expiresOn')} guide={t('vault.expiresOnGuide')}>
              {(p) => <Input {...p} type="date" value={f.expiresOn} onChange={set('expiresOn')} />}
            </FormField>
            <FormField label={t('contracts.vendor')}>
              {(p) => (
                <NativeSelect {...p} value={f.vendorId} onChange={set('vendorId')}>
                  <option value="">{t('contracts.noSupplier')}</option>
                  {(vendors.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('vault.managedDevices')}</legend>
            <p className="text-xs text-muted-foreground">{t('vault.managedDevicesGuide')}</p>
            <DevicePicker orgId={orgId} value={devices} onChange={setDevices} />
          </fieldset>
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
          <Button type="submit" form="cloud-form" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
