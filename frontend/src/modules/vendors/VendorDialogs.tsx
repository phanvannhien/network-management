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
import {
  VENDOR_KINDS,
  useVendorMutations,
  type Vendor,
  type VendorContact,
  type VendorKind,
} from './vendors'

/** Add / edit a vendor (P2-04). */
export function VendorDialog({
  orgId,
  vendor,
  onClose,
  onSaved,
}: {
  orgId: string
  vendor?: Vendor
  onClose: () => void
  onSaved?: (v: Vendor) => void
}) {
  const { t } = useTranslation()
  const { save } = useVendorMutations(orgId)
  const [f, setF] = useState({
    kind: vendor?.kind ?? ('supplier' as VendorKind),
    name: vendor?.name ?? '',
    taxCode: vendor?.taxCode ?? '',
    website: vendor?.website ?? '',
    supportPhone: vendor?.supportPhone ?? '',
    supportEmail: vendor?.supportEmail ?? '',
    supportPortal: vendor?.supportPortal ?? '',
    notes: vendor?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { id: vendor?.id, body: { ...f, ...(vendor ? { version: vendor.version } : {}) } },
      {
        onSuccess: (v) => {
          toast.success(t('vendors.saved'))
          if (v) onSaved?.(v)
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
          <DialogTitle>{vendor ? t('vendors.edit') : t('vendors.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" id="vendor-form">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField className="sm:col-span-2" label={t('vendors.name')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
            <FormField label={t('vendors.kind')} guide={t(`vendors.kindGuides.${f.kind}`)}>
              {(p) => (
                <NativeSelect {...p} value={f.kind} onChange={set('kind')}>
                  {VENDOR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vendors.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('vendors.supportPhone')} guide={t('vendors.supportPhoneGuide')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={100}
                  value={f.supportPhone}
                  onChange={set('supportPhone')}
                />
              )}
            </FormField>
            <FormField label={t('vendors.supportEmail')}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  maxLength={320}
                  value={f.supportEmail}
                  onChange={set('supportEmail')}
                />
              )}
            </FormField>
            <FormField label={t('vendors.supportPortal')} guide={t('vendors.supportPortalGuide')}>
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  placeholder="https://support.fortinet.com"
                  maxLength={300}
                  value={f.supportPortal}
                  onChange={set('supportPortal')}
                />
              )}
            </FormField>
            <FormField label={t('vendors.website')}>
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  placeholder="https://"
                  maxLength={300}
                  value={f.website}
                  onChange={set('website')}
                />
              )}
            </FormField>
            <FormField label={t('vendors.taxCode')} guide={t('vendors.taxCodeGuide')}>
              {(p) => <Input {...p} maxLength={50} value={f.taxCode} onChange={set('taxCode')} />}
            </FormField>
          </div>
          <FormField label={t('vendors.notes')}>
            {(p) => (
              <Textarea {...p} rows={3} maxLength={4000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="vendor-form" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Add / edit a contact person of a vendor. */
export function ContactDialog({
  orgId,
  vendorId,
  contact,
  onClose,
}: {
  orgId: string
  vendorId: string
  contact?: VendorContact
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { saveContact } = useVendorMutations(orgId)
  const [f, setF] = useState({
    name: contact?.name ?? '',
    title: contact?.title ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    notes: contact?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    saveContact.mutate(
      {
        vendorId,
        id: contact?.id,
        body: { ...f, ...(contact ? { version: contact.version } : {}) },
      },
      {
        onSuccess: () => {
          toast.success(t('vendors.contactSaved'))
          onClose()
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? t('vendors.editContact') : t('vendors.addContact')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" id="contact-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('vendors.contactName')} required>
              {(p) => (
                <Input {...p} required maxLength={200} value={f.name} onChange={set('name')} />
              )}
            </FormField>
            <FormField label={t('vendors.contactTitle')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={200}
                  placeholder={t('vendors.contactTitlePlaceholder')}
                  value={f.title}
                  onChange={set('title')}
                />
              )}
            </FormField>
            <FormField label={t('vendors.phone')}>
              {(p) => <Input {...p} maxLength={100} value={f.phone} onChange={set('phone')} />}
            </FormField>
            <FormField label={t('vendors.email')}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  maxLength={320}
                  value={f.email}
                  onChange={set('email')}
                />
              )}
            </FormField>
          </div>
          <FormField label={t('vendors.notes')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="contact-form" disabled={saveContact.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
