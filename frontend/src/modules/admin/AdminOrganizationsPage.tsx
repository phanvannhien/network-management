import { Building2, MoreHorizontal, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import type { AdminOrganization, OrganizationKind } from '@/api/client'
import { useSession } from '@/app/auth'
import {
  useAdminCreateOrganization,
  useAdminDeleteOrganization,
  useAdminOrganizations,
} from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { FormField } from '@/components/FormField'
import { useLocalTable } from '@/components/localTable'
import { NativeSelect } from '@/components/NativeSelect'
import { OrgAvatar } from '@/components/OrgAvatar'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/lib/format'

const ORG_SORT: Record<string, (o: AdminOrganization) => string | number> = {
  name: (o) => o.name,
  kind: (o) => o.kind,
  memberCount: (o) => o.memberCount,
  categoryCount: (o) => o.categoryCount,
  siteCount: (o) => o.siteCount,
  createdAt: (o) => o.createdAt,
}

function CreateOrganizationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const create = useAdminCreateOrganization()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OrganizationKind>('customer')
  const [notes, setNotes] = useState('')
  const [addMeAsOwner, setAddMeAsOwner] = useState(true)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name, kind, notes, addMeAsOwner },
      {
        onSuccess: (org) => {
          toast.success(t('adminOrgs.created', { name: org.name }))
          setName('')
          setNotes('')
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4" aria-label={t('adminOrgs.create')}>
          <DialogHeader>
            <DialogTitle>{t('adminOrgs.create')}</DialogTitle>
          </DialogHeader>
          <FormField label={t('adminOrgs.name')} required>
            {(f) => (
              <Input
                {...f}
                required
                autoFocus
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('adminOrgs.kind')}>
            {(f) => (
              <NativeSelect
                {...f}
                value={kind}
                onChange={(e) => setKind(e.target.value as OrganizationKind)}
              >
                <option value="customer">{t('adminOrgs.customer')}</option>
                <option value="internal">{t('adminOrgs.internal')}</option>
              </NativeSelect>
            )}
          </FormField>
          <FormField label={t('adminOrgs.notes')}>
            {(f) => (
              <Textarea
                {...f}
                maxLength={2000}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </FormField>
          <label className="flex items-start gap-2 text-form">
            <Checkbox
              checked={addMeAsOwner}
              onCheckedChange={(v) => setAddMeAsOwner(!!v)}
              className="mt-1"
            />
            <span>
              {t('adminOrgs.addMeAsOwner')}
              <span className="block text-label text-muted-foreground">
                {t('adminOrgs.addMeAsOwnerHint')}
              </span>
            </span>
          </label>
          {create.isError && (
            <p role="alert" className="text-destructive">
              {create.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('adminOrgs.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** System admin: list, create and soft-delete organizations (ADR-023). Server enforces the role. */
export function AdminOrganizationsPage() {
  const { t } = useTranslation()
  const session = useSession()
  const orgs = useAdminOrganizations()
  const remove = useAdminDeleteOrganization()
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<AdminOrganization | null>(null)
  const userId = session.data?.user.id ?? ''
  useBreadcrumbs([{ label: t('adminOrgs.title') }])

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const kinds = filter.facets.kind ?? []
    return orgs.data?.filter(
      (o) =>
        (!q || o.name.toLowerCase().includes(q)) && (kinds.length === 0 || kinds.includes(o.kind)),
    )
  }, [orgs.data, filter])
  const table = useLocalTable(filtered, ORG_SORT, [{ id: 'name', desc: false }])

  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />

  const kindLabel = (k: OrganizationKind) =>
    k === 'customer' ? t('adminOrgs.customer') : t('adminOrgs.internal')
  const columns: DataColumn<AdminOrganization>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t('adminOrgs.name'),
      meta: { label: t('adminOrgs.name'), width: 320, pin: true, alwaysVisible: true },
      cell: ({ row: { original: o } }) => (
        <span className="flex items-center gap-2">
          <OrgAvatar id={o.id} name={o.name} size="sm" />
          <span className="truncate font-medium">{o.name}</span>
        </span>
      ),
    },
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t('adminOrgs.kind'),
      meta: { label: t('adminOrgs.kind'), width: 120 },
      cell: ({ row }) => kindLabel(row.original.kind),
    },
    {
      id: 'memberCount',
      accessorKey: 'memberCount',
      header: t('adminOrgs.members'),
      meta: { label: t('adminOrgs.members'), width: 120, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.memberCount}</span>,
    },
    {
      id: 'categoryCount',
      accessorKey: 'categoryCount',
      header: t('adminOrgs.categories'),
      meta: { label: t('adminOrgs.categories'), width: 100, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.categoryCount}</span>,
    },
    {
      id: 'siteCount',
      accessorKey: 'siteCount',
      header: t('adminOrgs.sitesCount'),
      meta: { label: t('adminOrgs.sitesCount'), width: 90, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.siteCount}</span>,
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: t('adminOrgs.createdAt'),
      meta: { label: t('adminOrgs.createdAt'), width: 130 },
      cell: ({ row }) => (
        <time dateTime={row.original.createdAt}>{formatDate(row.original.createdAt)}</time>
      ),
    },
    {
      id: 'notes',
      accessorKey: 'notes',
      header: t('adminOrgs.notes'),
      enableSorting: false,
      meta: { label: t('adminOrgs.notes'), width: 360 },
      cell: ({ row }) =>
        row.original.notes || <span className="text-muted-foreground">{t('common.none')}</span>,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('common.more')}</span>,
      enableSorting: false,
      meta: { label: t('common.more'), width: 48, alwaysVisible: true, align: 'right' },
      cell: ({ row: { original: o } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('table.rowActions', { name: o.name })}
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(o)}>
              {t('adminOrgs.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const count = (k: OrganizationKind) => orgs.data?.filter((o) => o.kind === k).length ?? 0

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('adminOrgs.title')}
        count={orgs.data?.length}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t('adminOrgs.create')}
          </Button>
        }
      />
      {remove.isError && (
        <p role="alert" className="text-destructive">
          {remove.error.message}
        </p>
      )}
      <DataTable
        tableId="admin-organizations"
        userId={userId}
        caption={t('adminOrgs.title')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={orgs.isPending}
        error={orgs.error}
        getRowId={(o) => o.id}
        rowLabel={(o) => o.name}
        pagination={table.pagination}
        onPaginationChange={table.onPaginationChange}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        maxHeight="calc(100vh - 220px)"
        filters={
          <FilterBar
            value={filter}
            onChange={(f) => {
              setFilter(f)
              table.resetPage()
            }}
            facets={[
              {
                id: 'kind',
                label: t('adminOrgs.kind'),
                options: (['customer', 'internal'] as const).map((k) => ({
                  value: k,
                  label: kindLabel(k),
                  count: count(k),
                })),
              },
            ]}
            searchPlaceholder={t('adminOrgs.searchPlaceholder')}
            storageKey={`ntb-filters:${userId}:admin-organizations`}
          />
        }
        empty={<EmptyState icon={<Building2 />} title={t('adminOrgs.emptyTitle')} />}
      />

      <CreateOrganizationDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('adminOrgs.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('adminOrgs.deleteBody')}
        consequences={[
          t('adminOrgs.deleteConsequenceMembers', { count: deleting?.memberCount ?? 0 }),
          t('adminOrgs.deleteConsequenceLinks'),
        ]}
        confirmText={deleting?.name}
        confirmLabel={t('adminOrgs.delete')}
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) {
            const name = deleting.name
            remove.mutate(deleting.id, {
              onSuccess: () => toast.success(t('adminOrgs.deleted', { name })),
            })
          }
          setDeleting(null)
        }}
      />
    </div>
  )
}
