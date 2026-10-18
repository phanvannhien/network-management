import { Download, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'
import { ContractDialog } from './ContractDialog'
import { SupportBox } from './SupportBox'
import { fileUrl, useContract, useContractMutations } from './vendors'

const sizeText = (n: number) =>
  n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/** One contract: dates and terms, what it covers, attached files, how to reach the vendor (P2-04). */
export function ContractPage() {
  const { t } = useTranslation()
  const { orgId = '', contractId = '' } = useParams()
  const navigate = useNavigate()
  const detail = useContract(orgId, contractId)
  const { remove, upload, removeFile } = useContractMutations(orgId)
  const org = useOrganization(orgId)
  const role = org.data?.membership.role
  const canEdit = role === 'owner' || role === 'admin' || role === 'editor'
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingFile, setDeletingFile] = useState<{ id: string; name: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const k = detail.data?.contract
  useBreadcrumbs([
    { label: t('vendors.title'), to: `/o/${orgId}/vendors?tab=contracts` },
    { label: k?.name ?? '…' },
  ])
  if (detail.isError) return <NotFoundPage inShell />
  if (!detail.data || !k) return <Skeleton className="m-4 h-64" />
  const d = detail.data

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title={k.name}
        description={[t(`contracts.kinds.${k.kind}`), k.number].filter(Boolean).join(' · ')}
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
          className="rounded-lg border border-border bg-card p-4 lg:col-span-2"
          aria-label={t('contracts.terms')}
        >
          <KeyValueList
            columns={2}
            wrap
            items={[
              {
                label: t('contracts.vendor'),
                value: (
                  <Link to={`/o/${orgId}/vendors/${k.vendorId}`} className="hover:underline">
                    {k.vendorName}
                  </Link>
                ),
              },
              { label: t('contracts.number'), value: k.number || '—' },
              {
                label: t('contracts.startDate'),
                value: k.startDate ? formatDate(k.startDate) : '—',
              },
              { label: t('contracts.endDate'), value: <WarrantyText date={k.endDate} /> },
              { label: t('contracts.sla'), value: k.sla || '—' },
              { label: t('vendors.notes'), value: k.notes || '—' },
            ]}
          />
        </section>
        <section
          className="space-y-2 rounded-lg border border-border bg-card p-4"
          aria-label={t('vendors.support')}
        >
          <h2 className="font-semibold">{t('vendors.support')}</h2>
          <SupportBox
            name={k.vendorName}
            phone={k.supportPhone}
            email={k.supportEmail}
            portal={k.supportPortal}
            contacts={d.contacts}
          />
        </section>
      </div>
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-4"
        aria-label={t('contracts.covers')}
      >
        <h2 className="font-semibold">{t('contracts.covers')}</h2>
        {d.devices.length === 0 && d.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('contracts.coversNothing')}</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {d.devices.map((x) => (
              <li key={x.id}>
                <Link
                  to={`/o/${orgId}/devices/${x.id}`}
                  className="font-mono text-tech hover:underline"
                >
                  {x.hostname}
                </Link>{' '}
                <span className="text-muted-foreground">
                  {x.siteCode} · {t(`devices.types.${x.type}`)}
                  {x.model && ` · ${x.model}`}
                </span>
              </li>
            ))}
            {d.links.map((l) => (
              <li key={l.id}>
                {l.aName} ↔ {l.bName}
                <span className="text-muted-foreground">
                  {l.provider && ` · ${l.provider}`}
                  {l.circuitId && ` · ${t('contracts.circuit', { id: l.circuitId })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-4"
        aria-label={t('contracts.files')}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('contracts.files')}</h2>
          {canEdit && (
            <>
              <input
                ref={input}
                type="file"
                className="hidden"
                aria-label={t('contracts.attach')}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (file.size > 10 * 1024 * 1024) {
                    toast.error(t('contracts.tooBig'))
                    return
                  }
                  upload.mutate(
                    { contractId: k.id, file },
                    {
                      onSuccess: () => toast.success(t('contracts.attached', { name: file.name })),
                      onError: (err) => toast.error(err.message),
                    },
                  )
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={upload.isPending}
                onClick={() => input.current?.click()}
              >
                <Paperclip aria-hidden />{' '}
                {upload.isPending ? t('contracts.uploading') : t('contracts.attach')}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('contracts.filesGuide')}</p>
        {d.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('contracts.noFiles')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {d.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5">
                <a
                  href={fileUrl(orgId, f.id)}
                  className="flex flex-1 items-center gap-1.5 hover:underline"
                >
                  <Download aria-hidden className="size-3.5" /> {f.name}
                </a>
                <span className="text-xs text-muted-foreground">
                  {sizeText(f.size)} · {formatDate(f.createdAt)}
                </span>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('contracts.deleteFile', { name: f.name })}
                    onClick={() =>
                      removeFile.mutate(f.id, { onError: (e) => toast.error(e.message) })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <ContractDialog orgId={orgId} detail={d} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deletingFile !== null}
        onOpenChange={(o) => !o && setDeletingFile(null)}
        title={t('contracts.deleteFileTitle', { name: deletingFile?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() =>
          deletingFile &&
          removeFile.mutate(deletingFile.id, { onError: (e) => toast.error(e.message) })
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('contracts.deleteTitle', { name: k.name })}
        description={t('contracts.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() =>
          remove.mutate(k.id, {
            onSuccess: () => void navigate(`/o/${orgId}/vendors?tab=contracts`),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
