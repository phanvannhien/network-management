import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DEVICE_ROLES,
  LIFECYCLES,
  useBulkUpdateDevices,
  type DeviceBulkUpdate,
  type DeviceLifecycle,
  type DeviceRole,
} from './devices'

const splitTags = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** Bulk edit (SRS §4.1): only the fields the user sets change; the server applies it all or nothing. */
export function BulkEditDialog({
  orgId,
  ids,
  onClose,
}: {
  orgId: string
  ids: string[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const bulk = useBulkUpdateDevices(orgId)
  const [lifecycle, setLifecycle] = useState('')
  const [role, setRole] = useState('')
  const [managed, setManaged] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [addTags, setAddTags] = useState('')
  const [removeTags, setRemoveTags] = useState('')

  const body: DeviceBulkUpdate = {
    ids,
    ...(lifecycle && { lifecycle: lifecycle as DeviceLifecycle }),
    ...(role && { role: role as DeviceRole }),
    ...(managed && { managed: managed === 'yes' }),
    ...(owner !== null && { ownerName: owner }),
    ...(splitTags(addTags).length > 0 && { addTags: splitTags(addTags) }),
    ...(splitTags(removeTags).length > 0 && { removeTags: splitTags(removeTags) }),
  }
  const changes = Object.keys(body).length - 1

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    bulk.mutate(body, {
      onSuccess: (n) => {
        toast.success(t('devices.bulkSaved', { count: n }))
        onClose()
      },
    })
  }

  const keep = <option value="">{t('devices.keep')}</option>
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4" aria-label={t('devices.bulkEdit')}>
          <DialogHeader>
            <DialogTitle>{t('devices.bulkTitle', { count: ids.length })}</DialogTitle>
            <DialogDescription>{t('devices.bulkHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('devices.lifecycle')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={lifecycle}
                  onChange={(e) => setLifecycle(e.target.value)}
                >
                  {keep}
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
                <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value)}>
                  {keep}
                  {DEVICE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`devices.roleValues.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.managed')}>
              {(p) => (
                <NativeSelect {...p} value={managed} onChange={(e) => setManaged(e.target.value)}>
                  {keep}
                  <option value="yes">{t('devices.yes')}</option>
                  <option value="no">{t('devices.external')}</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.owner')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={200}
                  placeholder={t('devices.keep')}
                  value={owner ?? ''}
                  onChange={(e) => setOwner(e.target.value === '' ? null : e.target.value)}
                />
              )}
            </FormField>
            <FormField label={t('devices.addTags')} hint={t('devices.tagsHint')}>
              {(p) => <Input {...p} value={addTags} onChange={(e) => setAddTags(e.target.value)} />}
            </FormField>
            <FormField label={t('devices.removeTags')} hint={t('devices.tagsHint')}>
              {(p) => (
                <Input {...p} value={removeTags} onChange={(e) => setRemoveTags(e.target.value)} />
              )}
            </FormField>
          </div>
          {bulk.isError && (
            <p role="alert" className="text-destructive">
              {bulk.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={bulk.isPending || changes === 0}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
