import { ListPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useOrgAccess } from '@/modules/sites/access'
import {
  useCustomFieldMutations,
  useCustomFields,
  type CustomField,
  type CustomFieldKind,
} from './devices'

const KINDS: CustomFieldKind[] = ['text', 'number', 'date', 'boolean', 'select']

function FieldDialog({
  orgId,
  field,
  onClose,
}: {
  orgId: string
  field?: CustomField
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useCustomFieldMutations(orgId)
  const [f, setF] = useState({
    key: field?.key ?? '',
    label: field?.label ?? '',
    kind: (field?.kind ?? 'text') as CustomFieldKind,
    options: (field?.options ?? []).join('\n'),
    required: field?.required ?? false,
    sortOrder: String(field?.sortOrder ?? 0),
  })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        field,
        body: {
          key: f.key,
          label: f.label.trim(),
          kind: f.kind,
          options:
            f.kind === 'select'
              ? f.options
                  .split('\n')
                  .map((o) => o.trim())
                  .filter(Boolean)
              : [],
          required: f.required,
          sortOrder: Number(f.sortOrder) || 0,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('customFields.saved'))
          onClose()
        },
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={field ? t('customFields.edit') : t('customFields.add')}
        >
          <DialogHeader>
            <DialogTitle>{field ? t('customFields.edit') : t('customFields.add')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('customFields.label')} required>
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={100}
                  value={f.label}
                  onChange={(e) => setF({ ...f, label: e.target.value })}
                />
              )}
            </FormField>
            <FormField label={t('customFields.key')} required hint={t('customFields.keyHint')}>
              {(p) => (
                <Input
                  {...p}
                  required
                  readOnly={Boolean(field)}
                  maxLength={40}
                  pattern="[a-z][a-z0-9_]{0,39}"
                  value={f.key}
                  onChange={(e) =>
                    setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })
                  }
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('customFields.kind')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  disabled={Boolean(field)}
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value as CustomFieldKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`customFields.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('customFields.sortOrder')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  value={f.sortOrder}
                  onChange={(e) => setF({ ...f, sortOrder: e.target.value })}
                />
              )}
            </FormField>
          </div>
          {f.kind === 'select' && (
            <FormField
              label={t('customFields.options')}
              required
              hint={t('customFields.optionsHint')}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  value={f.options}
                  onChange={(e) => setF({ ...f, options: e.target.value })}
                />
              )}
            </FormField>
          )}
          <label className="flex items-center gap-2 text-form">
            <Checkbox
              checked={f.required}
              onCheckedChange={(on) => setF({ ...f, required: on === true })}
            />
            {t('customFields.required')}
          </label>
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

/** Custom device fields of the organization (SRS §4.1 "Mở rộng"), managed by owners/admins. */
export function CustomFieldsPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const fields = useCustomFields(orgId)
  const { remove } = useCustomFieldMutations(orgId)
  const canAdmin = useOrgAccess(orgId).orgAdmin
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null)
  const [deleting, setDeleting] = useState<CustomField | null>(null)
  useBreadcrumbs([{ label: t('customFields.title') }])

  return (
    <div className="max-w-4xl space-y-3 p-4">
      <PageHeader
        title={t('customFields.title')}
        actions={
          canAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> {t('customFields.add')}
            </Button>
          )
        }
      />
      <p className="text-muted-foreground">{t('customFields.subtitle')}</p>
      {fields.isPending ? (
        <Skeleton className="h-24" />
      ) : fields.isError ? (
        <p role="alert" className="text-destructive">
          {fields.error.message}
        </p>
      ) : fields.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<ListPlus />} title={t('customFields.empty')} />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {fields.data.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-mono text-tech">{f.key}</span> ·{' '}
                  {t(`customFields.kinds.${f.kind}`)}
                  {f.kind === 'select' && ` · ${f.options.join(', ')}`}
                </div>
              </div>
              {canAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('customFields.edit')} ${f.label}`}
                    onClick={() => setEditing(f)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('customFields.delete')} ${f.label}`}
                    onClick={() => setDeleting(f)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <FieldDialog
          orgId={orgId}
          field={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('customFields.deleteTitle', { label: deleting?.label ?? '' })}
        description={t('customFields.deleteBody')}
        confirmLabel={t('customFields.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
