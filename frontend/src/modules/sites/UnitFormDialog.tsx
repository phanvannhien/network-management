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
import { UNIT_RELATIONS, useSaveUnit, type BusinessUnit } from './sites'

type Relation = (typeof UNIT_RELATIONS)[number]

/** Create or edit a business unit (ADR-026); the code follows ADR-030 and is upper-cased as typed. */
export function UnitFormDialog({
  orgId,
  unit,
  onClose,
  onSaved,
}: {
  orgId: string
  unit?: BusinessUnit
  onClose: () => void
  onSaved?: (unit: BusinessUnit) => void
}) {
  const { t } = useTranslation()
  const save = useSaveUnit(orgId)
  const [f, setF] = useState({
    code: unit?.code ?? '',
    name: unit?.name ?? '',
    relation: (unit?.relation ?? 'subsidiary') as Relation,
    contactName: unit?.contactName ?? '',
    contactPhone: unit?.contactPhone ?? '',
    contactEmail: unit?.contactEmail ?? '',
    notes: unit?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const codeValid = /^[A-Z][A-Z0-9]{1,7}$/.test(f.code) && f.code !== 'SHARED'

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
            <DialogTitle>{unit ? t('units.edit') : t('units.add')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <FormField
              label={t('units.code')}
              required
              hint={unit ? t('units.renameHint') : t('units.codeHint')}
              error={f.code && !codeValid ? t('units.codeHint') : undefined}
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
            <FormField label={t('units.name')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
          </div>
          <FormField label={t('units.relation')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={f.relation}
                onChange={(e) => setF({ ...f, relation: e.target.value as Relation })}
              >
                {UNIT_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`units.relations.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-form font-medium">{t('units.contact')}</legend>
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
