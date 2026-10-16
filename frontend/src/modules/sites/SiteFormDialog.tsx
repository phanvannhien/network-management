import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
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
import { useSaveSite, type Site } from './sites'

/** Common IANA zones first; any valid IANA name is accepted by the API. */
const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'UTC',
]

/** Create (site undefined) or edit a site. Remounted per open, so fields start from the site. */
export function SiteFormDialog({
  orgId,
  site,
  open,
  onClose,
  onSaved,
}: {
  orgId: string
  site?: Site
  open: boolean
  onClose: () => void
  onSaved?: (site: Site) => void
}) {
  const { t } = useTranslation()
  const save = useSaveSite(orgId)
  const [f, setF] = useState({
    code: site?.code ?? '',
    name: site?.name ?? '',
    address: site?.address ?? '',
    timezone: site?.timezone ?? 'Asia/Ho_Chi_Minh',
    contactName: site?.contactName ?? '',
    contactPhone: site?.contactPhone ?? '',
    contactEmail: site?.contactEmail ?? '',
    notes: site?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { siteId: site?.id, body: f, version: site?.version },
      {
        onSuccess: (saved) => {
          toast.success(site ? t('sites.saved') : t('sites.created', { code: saved.code }))
          onSaved?.(saved)
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={site ? t('sites.edit') : t('sites.add')}
        >
          <DialogHeader>
            <DialogTitle>{site ? t('sites.edit') : t('sites.add')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <FormField label={t('sites.code')} hint={t('sites.codeHint')} required>
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={32}
                  value={f.code}
                  onChange={set('code')}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('sites.name')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
          </div>
          <FormField label={t('sites.address')}>
            {(p) => <Input {...p} maxLength={500} value={f.address} onChange={set('address')} />}
          </FormField>
          <FormField label={t('sites.timezone')}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list="ntb-timezones"
                  value={f.timezone}
                  onChange={set('timezone')}
                  className="font-mono"
                />
                <datalist id="ntb-timezones">
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-form font-medium">{t('sites.contact')}</legend>
            <FormField label={t('sites.contactName')}>
              {(p) => (
                <Input {...p} maxLength={200} value={f.contactName} onChange={set('contactName')} />
              )}
            </FormField>
            <FormField label={t('sites.contactPhone')}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  maxLength={50}
                  value={f.contactPhone}
                  onChange={set('contactPhone')}
                />
              )}
            </FormField>
            <FormField label={t('sites.contactEmail')}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  maxLength={320}
                  value={f.contactEmail}
                  onChange={set('contactEmail')}
                />
              )}
            </FormField>
          </fieldset>
          <FormField label={t('sites.notes')}>
            {(p) => (
              <Textarea {...p} rows={3} maxLength={2000} value={f.notes} onChange={set('notes')} />
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
