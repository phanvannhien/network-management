import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  buildTree,
  flattenTree,
  previewCategory,
  subtreeIds,
  useCategories,
  useCategoryMutations,
  type Category,
  type CategoryInput,
  type SiteCodeChange,
} from './sites'

/** Site codes that will change — shown before anything is written (ADR-032). */
export function SiteCodeChangesDialog({
  changes,
  pending,
  onConfirm,
  onCancel,
}: {
  changes: SiteCodeChange[]
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('categories.recodeTitle', { count: changes.length })}</DialogTitle>
          <DialogDescription>{t('categories.recodeBody')}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {changes.map((c) => (
            <li key={c.siteId} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="font-mono text-tech text-muted-foreground line-through">
                {c.from}
              </span>
              <span aria-hidden>→</span>
              <span className="sr-only">{t('categories.becomes')}</span>
              <span className="font-mono text-tech font-medium">{c.to}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {t('categories.recodeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Create (category undefined) or edit a category; re-coding sites asks for confirmation first. */
export function CategoryFormDialog({
  orgId,
  category,
  defaultParentId,
  onClose,
  onSaved,
}: {
  orgId: string
  category?: Category
  defaultParentId?: string | null
  onClose: () => void
  onSaved?: (c: Category) => void
}) {
  const { t } = useTranslation()
  const categories = useCategories(orgId)
  const { save } = useCategoryMutations(orgId)
  const [f, setF] = useState({
    name: category?.name ?? '',
    code: category?.code ?? '',
    parentId: category ? category.parentId : (defaultParentId ?? null),
    contactName: category?.contactName ?? '',
    contactPhone: category?.contactPhone ?? '',
    contactEmail: category?.contactEmail ?? '',
    notes: category?.notes ?? '',
  })
  const [changes, setChanges] = useState<SiteCodeChange[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  // A category cannot move under itself or one of its children.
  const excluded =
    category && categories.data ? subtreeIds(categories.data, category.id) : new Set<string>()
  const parents = flattenTree(buildTree(categories.data ?? [])).filter((c) => !excluded.has(c.id))
  const body: CategoryInput = {
    name: f.name.trim(),
    code: f.code.trim().toUpperCase(),
    parentId: f.parentId,
    contactName: f.contactName,
    contactPhone: f.contactPhone,
    contactEmail: f.contactEmail,
    notes: f.notes,
  }
  const submit = (confirm: boolean) =>
    save.mutate(
      { category, body, confirm },
      {
        onSuccess: (c) => {
          toast.success(t('categories.saved'))
          onSaved?.(c)
          onClose()
        },
        onError: (e) => {
          setChanges(null)
          setError(e.message)
        },
      },
    )
  const onSubmit = async () => {
    setError(null)
    if (category && (body.code !== category.code || body.parentId !== category.parentId)) {
      try {
        const list = await previewCategory(orgId, category, body)
        if (list.length > 0) {
          setChanges(list)
          return
        }
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    submit(false)
  }
  const title = category ? t('categories.edit') : t('categories.add')
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form
            aria-label={title}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void onSubmit()
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">{t('guides.category')}</p>
            <div className="grid grid-cols-[1fr_9rem] gap-3">
              <FormField label={t('categories.name')} required hint={t('categories.nameHint')}>
                {(p) => (
                  <Input
                    {...p}
                    required
                    autoFocus
                    maxLength={200}
                    value={f.name}
                    onChange={set('name')}
                  />
                )}
              </FormField>
              <FormField label={t('categories.code')} required hint={t('categories.codeHint')}>
                {(p) => (
                  <Input
                    {...p}
                    required
                    maxLength={12}
                    value={f.code}
                    onChange={(e) =>
                      setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                    }
                    className="font-mono uppercase"
                  />
                )}
              </FormField>
            </div>
            <FormField label={t('categories.parent')} guide={t('guides.categoryParent')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.parentId ?? ''}
                  onChange={(e) => setF({ ...f, parentId: e.target.value || null })}
                >
                  <option value="">{t('categories.topLevel')}</option>
                  {parents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'  '.repeat(c.depth + 1)}
                      {c.name} ({c.code})
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label={t('categories.contact')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={200}
                    value={f.contactName}
                    onChange={set('contactName')}
                  />
                )}
              </FormField>
              <FormField label={t('sites.contactPhone')}>
                {(p) => (
                  <Input
                    {...p}
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
            </div>
            <FormField label={t('sites.notes')}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={2000}
                  value={f.notes}
                  onChange={set('notes')}
                />
              )}
            </FormField>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
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
      {changes && (
        <SiteCodeChangesDialog
          changes={changes}
          pending={save.isPending}
          onConfirm={() => submit(true)}
          onCancel={() => setChanges(null)}
        />
      )}
    </>
  )
}
