import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'
import { ContractDialog } from './ContractDialog'
import { SupportBox, safeHref } from './SupportBox'
import { ContactDialog, VendorDialog } from './VendorDialogs'
import { useVendor, useVendorMutations, type VendorContact } from './vendors'
import { useHelpTopic } from '@/help/topic'

/** One vendor: support channels, contact people, contracts (P2-04). */
export function VendorDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', vendorId = '' } = useParams()
  const navigate = useNavigate()
  const detail = useVendor(orgId, vendorId)
  const { remove, removeContact } = useVendorMutations(orgId)
  const org = useOrganization(orgId)
  const role = org.data?.membership.role
  const canEdit = role === 'owner' || role === 'admin' || role === 'editor'
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<VendorContact | 'new' | null>(null)
  const [addingContract, setAddingContract] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const v = detail.data?.vendor
  useBreadcrumbs([
    { label: t('vendors.title'), to: `/o/${orgId}/vendors` },
    { label: v?.name ?? '…' },
  ])
  useHelpTopic('nha-cung-cap')
  if (detail.isError) return <NotFoundPage inShell />
  if (!detail.data || !v) return <Skeleton className="m-4 h-64" />
  const d = detail.data

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title={v.name}
        description={[
          t(`vendors.kinds.${v.kind}`),
          v.taxCode && `${t('vendors.taxCode')}: ${v.taxCode}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t('common.edit')}
              </Button>
              <Button variant="outline" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden /> {t('common.delete')}
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section
          className="space-y-2 rounded-lg border border-border bg-card p-4"
          aria-label={t('vendors.support')}
        >
          <h2 className="font-semibold">{t('vendors.support')}</h2>
          <SupportBox phone={v.supportPhone} email={v.supportEmail} portal={v.supportPortal} />
          {safeHref(v.website) && (
            <a
              href={safeHref(v.website)!}
              target="_blank"
              rel="noreferrer noopener"
              className="block text-sm text-primary hover:underline"
            >
              {v.website}
            </a>
          )}
          {v.notes && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{v.notes}</p>
          )}
        </section>
        <section
          className="space-y-2 rounded-lg border border-border bg-card p-4 lg:col-span-2"
          aria-label={t('vendors.contacts')}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t('vendors.contacts')}</h2>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setContact('new')}>
                <Plus aria-hidden /> {t('vendors.addContact')}
              </Button>
            )}
          </div>
          {d.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('vendors.noContacts')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-1.5">
                  <span className="flex-1">
                    <span className="font-medium">{c.name}</span>
                    {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="ml-2 hover:underline">
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="ml-2 hover:underline">
                        {c.email}
                      </a>
                    )}
                  </span>
                  {canEdit && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('vendors.editContactOf', { name: c.name })}
                        onClick={() => setContact(c)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('vendors.deleteContactOf', { name: c.name })}
                        onClick={() =>
                          removeContact.mutate(c.id, { onError: (e) => toast.error(e.message) })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-4"
        aria-label={t('contracts.tab')}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('contracts.tab')}</h2>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setAddingContract(true)}>
              <Plus aria-hidden /> {t('contracts.add')}
            </Button>
          )}
        </div>
        {d.contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('contracts.none')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {d.contracts.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <Link to={`/o/${orgId}/contracts/${k.id}`} className="font-medium hover:underline">
                  {k.name}
                </Link>
                <span className="text-muted-foreground">{t(`contracts.kinds.${k.kind}`)}</span>
                <span className="ml-auto">
                  <WarrantyText date={k.endDate} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <VendorDialog orgId={orgId} vendor={v} onClose={() => setEditing(false)} />}
      {contact && (
        <ContactDialog
          orgId={orgId}
          vendorId={v.id}
          contact={contact === 'new' ? undefined : contact}
          onClose={() => setContact(null)}
        />
      )}
      {addingContract && (
        <ContractDialog
          orgId={orgId}
          vendorId={v.id}
          onClose={() => setAddingContract(false)}
          onSaved={(k) => void navigate(`/o/${orgId}/contracts/${k.contract.id}`)}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('vendors.deleteTitle', { name: v.name })}
        description={t('vendors.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() =>
          remove.mutate(v.id, {
            onSuccess: () => void navigate(`/o/${orgId}/vendors`),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
