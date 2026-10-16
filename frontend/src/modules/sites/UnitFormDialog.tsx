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
import { usePartners, useSaveUnit, type BusinessUnit } from './sites'

/**
 * Create or edit a business unit (ADR-031): a unit belongs to one partner, chosen at creation and fixed
 * afterwards. The code is unique within the partner and upper-cased as typed.
 */
export function UnitFormDialog({
  orgId,
  unit,
  defaultPartnerId,
  onClose,
  onSaved,
}: {
  orgId: string
  unit?: BusinessUnit
  defaultPartnerId?: string
  onClose: () => void
  onSaved?: (unit: BusinessUnit) => void
}) {
  const { t } = useTranslation()
  const save = useSaveUnit(orgId)
  const org = useOrganization(orgId).data?.organization.name ?? ''
  const partners = usePartners(orgId)
  const defaultPartner = partners.data?.find((p) => p.id === defaultPartnerId)
  const [f, setF] = useState({
    code: unit?.code ?? '',
    name: unit?.name ?? '',
    partnerId: unit?.partnerId ?? defaultPartnerId ?? '',
    contactName: unit?.contactName ?? '',
    contactPhone: unit?.contactPhone ?? '',
    contactEmail: unit?.contactEmail ?? '',
    notes: unit?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const codeValid = /^[A-Z][A-Z0-9]{1,7}$/.test(f.code)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { unit, body: f },
      {
        onSuccess: (saved) => {
          toast.success(unit ? t('sites.saved') : t('units.created', { code: saved.code }))
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
          aria-label={unit ? t('units.edit') : t('units.add')}
        >
          <DialogHeader>
            <DialogTitle>
              {unit
                ? t('units.edit')
                : defaultPartner
                  ? t('units.addToPartner', { partner: defaultPartner.name })
                  : t('units.addTo', { org })}
            </DialogTitle>
          </DialogHeader>
          <FormField
            label={t('units.partner')}
            help="partner-unit"
            required
            hint={unit ? t('units.partnerFixed') : undefined}
            error={partners.data?.length === 0 ? t('units.needPartner') : undefined}
          >
            {(p) => (
              <NativeSelect
                {...p}
                required
                disabled={Boolean(unit)}
                value={f.partnerId}
                onChange={(e) => setF({ ...f, partnerId: e.target.value })}
              >
                {unit ? (
                  <option value={unit.partnerId}>
                    {unit.partnerCode} · {unit.partnerName}
                  </option>
                ) : (
                  <>
                    <option value="">{t('units.choosePartner')}</option>
                    {/* Units are added to partners the caller administers (ADR-031). */}
                    {(partners.data ?? [])
                      .filter((pt) => pt.access === 'admin')
                      .map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.code} · {pt.name}
                        </option>
                      ))}
                  </>
                )}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <FormField
              label={t('units.code')}
              help="partner-unit"
              required
              hint={unit ? t('units.renameHint') : t('units.codeHint')}
              error={f.code && !codeValid ? t('units.codeHint') : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus={Boolean(unit || defaultPartnerId)}
                  maxLength={8}
                  value={f.code}
                  onChange={(e) =>
                    setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                  }
                  className="font-mono uppercase"
                />
              )}
            </FormField>
            <FormField label={t('units.name')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
          </div>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-form font-medium">{t('units.contactGroup')}</legend>
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
            <Button type="submit" disabled={save.isPending || !codeValid || f.partnerId === ''}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
