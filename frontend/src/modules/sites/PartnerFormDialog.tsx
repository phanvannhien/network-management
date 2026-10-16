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
import { useOrganization } from '@/app/orgs'
import { PARTNER_RELATIONS, useSavePartner, type Partner, type PartnerRelation } from './sites'

/** Create or edit a partner (ADR-031); the code prefixes site codes (ADR-030) and is upper-cased as typed. */
export function PartnerFormDialog({
  orgId,
  partner,
  onClose,
  onSaved,
}: {
  orgId: string
  partner?: Partner
  onClose: () => void
  onSaved?: (partner: Partner) => void
}) {
  const { t } = useTranslation()
  const save = useSavePartner(orgId)
  const org = useOrganization(orgId).data?.organization.name ?? ''
  const [f, setF] = useState({
    code: partner?.code ?? '',
    name: partner?.name ?? '',
    relation: (partner?.relation ?? 'subsidiary') as PartnerRelation,
    contactName: partner?.contactName ?? '',
    contactPhone: partner?.contactPhone ?? '',
    contactEmail: partner?.contactEmail ?? '',
    notes: partner?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const codeValid = /^[A-Z][A-Z0-9]{1,7}$/.test(f.code) && f.code !== 'SHARED'

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { partner, body: f },
      {
        onSuccess: (saved) => {
          toast.success(partner ? t('sites.saved') : t('partners.created', { code: saved.code }))
          onSaved?.(saved)
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={partner ? t('partners.edit') : t('partners.add')}
        >
          <DialogHeader>
            <DialogTitle>{partner ? t('partners.edit') : t('partners.addTo', { org })}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <FormField
              label={t('partners.code')}
              help="partner-unit"
              required
              hint={partner ? t('partners.renameHint') : t('partners.codeHint')}
              error={f.code && !codeValid ? t('partners.codeHint') : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={8}
                  value={f.code}
                  onChange={(e) =>
                    setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                  }
                  className="font-mono uppercase"
                />
              )}
            </FormField>
            <FormField label={t('partners.name')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
          </div>
          <FormField label={t('partners.relationWith', { org })} guide={t('guides.relation')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={f.relation}
                onChange={(e) => setF({ ...f, relation: e.target.value as PartnerRelation })}
              >
                {PARTNER_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`partners.relationOf.${r}`, { org })}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-form font-medium">{t('partners.contactGroup')}</legend>
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
              <Textarea {...p} rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
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
            <Button type="submit" disabled={save.isPending || !codeValid}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
