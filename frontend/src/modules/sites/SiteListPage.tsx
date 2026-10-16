import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CategoryFormDialog } from './CategoryDialogs'
import { SiteFormDialog } from './SiteFormDialog'
import { SitesTable } from './SitesTable'
import { useOrgAccess } from './access'
import {
  buildTree,
  flattenTree,
  useCategories,
  useCategoryMutations,
  type Category,
  type CategoryNode,
} from './sites'

/**
 * "Danh mục & Sites" (SRS §3, ADR-032): the organization's category tree on the left (as deep as needed, may be
 * empty), the sites of the selected branch on the right. Sites can hang under any category or the organization.
 */
export function SiteListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const org = useOrganization(orgId).data?.organization
  const categories = useCategories(orgId)
  const { remove } = useCategoryMutations(orgId)
  const access = useOrgAccess(orgId)
  const canEdit = access.orgEdit
  const selectedId = params.get('category')
  const rows = useMemo(() => flattenTree(buildTree(categories.data ?? [])), [categories.data])
  const selected = rows.find((c) => c.id === selectedId) ?? null
  const [editing, setEditing] = useState<{ category?: Category; parentId?: string | null } | null>(
    null,
  )
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [addingSite, setAddingSite] = useState(false)
  useBreadcrumbs([{ label: t('nav.sites') }])
  const select = (id: string | null) => setParams(id ? { category: id } : {}, { replace: true })

  const nodeButton = (c: CategoryNode | null) => {
    const active = (c?.id ?? null) === (selected?.id ?? null)
    return (
      <button
        type="button"
        onClick={() => select(c?.id ?? null)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted',
          active && 'bg-accent font-medium text-accent-foreground',
        )}
        style={c ? { paddingLeft: `${0.5 + (c.depth + 1) * 1}rem` } : undefined}
      >
        <span className="truncate">{c ? c.name : (org?.name ?? t('categories.org'))}</span>
        <span className="shrink-0 font-mono text-tech text-muted-foreground">
          {c ? c.code : org?.code}
        </span>
        {c && c.siteCount > 0 && (
          <span data-numeric className="ml-auto shrink-0 text-muted-foreground">
            {c.siteCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('categories.hub')}
        description={t('categories.hubSubtitle')}
        actions={
          canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() => setEditing({ parentId: selected?.id ?? null })}
              >
                <Plus aria-hidden /> {selected ? t('categories.addChild') : t('categories.add')}
              </Button>
              <Button onClick={() => setAddingSite(true)}>
                <Plus aria-hidden /> {t('sites.add')}
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
        <nav
          aria-label={t('categories.tree')}
          className="space-y-0.5 rounded-lg border border-border bg-card p-2"
        >
          <div className="flex items-center gap-1">{nodeButton(null)}</div>
          {rows.map((c) => (
            <div key={c.id} className="group flex items-center gap-1">
              {nodeButton(c)}
              {canEdit && (
                <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`${t('categories.edit')} ${c.name}`}
                    onClick={() => setEditing({ category: c })}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`${t('categories.delete')} ${c.name}`}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="flex gap-2 px-2 py-2 text-muted-foreground">
              <FolderTree aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('categories.empty')}
            </p>
          )}
        </nav>
        <section aria-label={t('sites.title')} className="min-w-0 space-y-2">
          {selected && (
            <p className="text-muted-foreground">
              {selected.path}
              {selected.contactName && ` · ${selected.contactName}`}
              {selected.contactPhone && ` · ${selected.contactPhone}`}
            </p>
          )}
          <SitesTable
            orgId={orgId}
            categoryId={selected?.id}
            canEdit={canEdit}
            onAdd={() => setAddingSite(true)}
          />
        </section>
      </div>
      {editing && (
        <CategoryFormDialog
          orgId={orgId}
          category={editing.category}
          defaultParentId={editing.parentId}
          onClose={() => setEditing(null)}
          onSaved={(c) => select(c.id)}
        />
      )}
      {addingSite && (
        <SiteFormDialog
          orgId={orgId}
          open
          defaultCategoryId={selected?.id ?? null}
          onClose={() => setAddingSite(false)}
          onSaved={(s) => navigate(`/o/${orgId}/sites/${s.id}`)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('categories.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('categories.deleteBody')}
        confirmLabel={t('categories.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('categories.deleted'))
              if (selected?.id === deleting.id) select(null)
            },
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
