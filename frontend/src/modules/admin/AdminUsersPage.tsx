import { MoreHorizontal, ShieldCheck, ShieldOff, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { useLocalTable } from '@/components/localTable'
import { OneTimeLinkDialog } from '@/components/OneTimeLinkDialog'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDate } from '@/lib/format'
import {
  accountLink,
  useAdminPasswordReset,
  useAdminUserAction,
  useAdminUsers,
  type AdminUser,
} from './members'

type Confirm = { user: AdminUser; action: 'disable' | 'reset-mfa' }

const userStatus = (u: AdminUser) =>
  u.disabled ? 'disabled' : u.pendingInvite ? 'pending' : 'active'

const USER_SORT: Record<string, (u: AdminUser) => string | number> = {
  user: (u) => u.displayName || u.email,
  organizationCount: (u) => u.organizationCount,
  status: userStatus,
  createdAt: (u) => u.createdAt,
}

/** System admin: all users — disable/enable, reset MFA, issue password-reset links (P1-04). */
export function AdminUsersPage() {
  const { t } = useTranslation()
  const session = useSession()
  const users = useAdminUsers()
  const action = useAdminUserAction()
  const reset = useAdminPasswordReset()
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null)
  const myId = session.data?.user.id ?? ''
  useBreadcrumbs([{ label: t('adminUsers.title') }])

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const statuses = filter.facets.status ?? []
    const mfa = filter.facets.mfa ?? []
    return users.data?.filter(
      (u) =>
        (!q || u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)) &&
        (statuses.length === 0 || statuses.includes(userStatus(u))) &&
        (mfa.length === 0 || mfa.includes(u.mfaEnabled ? 'on' : 'off')),
    )
  }, [users.data, filter])
  const table = useLocalTable(filtered, USER_SORT, [{ id: 'user', desc: false }])

  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />

  const run = (user: AdminUser, kind: 'disable' | 'enable' | 'reset-mfa') =>
    action.mutate(
      { userId: user.id, action: kind },
      { onSuccess: () => toast.success(t('adminUsers.done')) },
    )

  const columns: DataColumn<AdminUser>[] = [
    {
      id: 'user',
      accessorFn: (u) => u.displayName || u.email,
      header: t('adminUsers.user'),
      meta: { label: t('adminUsers.user'), width: 300, pin: true, alwaysVisible: true },
      cell: ({ row: { original: u } }) => (
        <div className="leading-tight">
          <span className="font-medium">
            {u.displayName || (
              <span className="text-muted-foreground">{t('members.notActivated')}</span>
            )}
          </span>
          {u.isSystemAdmin && (
            <span className="ml-2 rounded-sm bg-system px-1 py-px text-[11px] font-semibold text-system-fg">
              {t('adminUsers.systemAdmin')}
            </span>
          )}
          <div className="text-label text-muted-foreground">{u.email}</div>
        </div>
      ),
    },
    {
      id: 'organizationCount',
      accessorKey: 'organizationCount',
      header: t('adminUsers.organizations'),
      meta: { label: t('adminUsers.organizations'), width: 110, align: 'right' },
      cell: ({ row }) => <span data-numeric>{row.original.organizationCount}</span>,
    },
    {
      id: 'mfa',
      header: t('adminUsers.mfa'),
      enableSorting: false,
      meta: { label: t('adminUsers.mfa'), width: 90 },
      cell: ({ row }) =>
        row.original.mfaEnabled ? (
          <span className="inline-flex items-center gap-1">
            <ShieldCheck aria-hidden className="size-4 text-status-up" /> {t('members.mfaOn')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ShieldOff aria-hidden className="size-4" /> {t('members.mfaOff')}
          </span>
        ),
    },
    {
      id: 'status',
      accessorFn: userStatus,
      header: t('adminUsers.status'),
      meta: { label: t('adminUsers.status'), width: 150 },
      cell: ({ row }) => {
        const s = userStatus(row.original)
        return (
          <StatusBadge
            status={s === 'active' ? 'up' : s === 'pending' ? 'planned' : 'notMonitored'}
            label={t(`members.${s}`)}
          />
        )
      },
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: t('adminUsers.createdAt'),
      meta: { label: t('adminUsers.createdAt'), width: 130 },
      cell: ({ row }) => (
        <time dateTime={row.original.createdAt}>{formatDate(row.original.createdAt)}</time>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('common.more')}</span>,
      enableSorting: false,
      meta: { label: t('common.more'), width: 48, alwaysVisible: true, align: 'right' },
      cell: ({ row: { original: u } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('table.rowActions', { name: u.email })}
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={() =>
                reset.mutate(u.id, {
                  onSuccess: (tok) => setResetLink({ email: u.email, link: accountLink(tok) }),
                })
              }
            >
              {t('adminUsers.resetLink')}
            </DropdownMenuItem>
            {u.mfaEnabled && (
              <DropdownMenuItem onClick={() => setConfirm({ user: u, action: 'reset-mfa' })}>
                {t('adminUsers.resetMfa')}
              </DropdownMenuItem>
            )}
            {u.id !== myId && (
              <>
                <DropdownMenuSeparator />
                {u.disabled ? (
                  <DropdownMenuItem onClick={() => run(u, 'enable')}>
                    {t('adminUsers.enable')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirm({ user: u, action: 'disable' })}
                  >
                    {t('adminUsers.disable')}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const count = (pred: (u: AdminUser) => boolean) => users.data?.filter(pred).length ?? 0
  const error = action.error ?? reset.error
  const email = confirm?.user.email ?? ''

  return (
    <div className="space-y-3 p-4">
      <PageHeader title={t('adminUsers.title')} count={users.data?.length} />
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      <DataTable
        tableId="admin-users"
        userId={myId}
        caption={t('adminUsers.title')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={users.isPending}
        error={users.error}
        getRowId={(u) => u.id}
        rowLabel={(u) => u.email}
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
                id: 'status',
                label: t('adminUsers.status'),
                options: (['active', 'pending', 'disabled'] as const).map((s) => ({
                  value: s,
                  label: t(`members.${s}`),
                  count: count((u) => userStatus(u) === s),
                })),
              },
              {
                id: 'mfa',
                label: t('adminUsers.mfa'),
                options: [
                  { value: 'on', label: t('members.mfaOn'), count: count((u) => u.mfaEnabled) },
                  { value: 'off', label: t('members.mfaOff'), count: count((u) => !u.mfaEnabled) },
                ],
              },
            ]}
            searchPlaceholder={t('adminUsers.searchPlaceholder')}
            storageKey={`ntb-filters:${myId}:admin-users`}
          />
        }
        empty={<EmptyState icon={<UserX />} title={t('adminUsers.emptyTitle')} />}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.action === 'disable'
            ? t('adminUsers.disableTitle', { email })
            : t('adminUsers.resetMfaTitle', { email })
        }
        description={
          confirm?.action === 'disable' ? t('adminUsers.disableBody') : t('adminUsers.resetMfaBody')
        }
        confirmLabel={
          confirm?.action === 'disable' ? t('adminUsers.disable') : t('adminUsers.resetMfa')
        }
        pending={action.isPending}
        onConfirm={() => {
          if (confirm) run(confirm.user, confirm.action)
          setConfirm(null)
        }}
      />
      <OneTimeLinkDialog
        link={resetLink?.link ?? null}
        title={t('adminUsers.resetLinkTitle')}
        description={t('adminUsers.resetLinkBody', { email: resetLink?.email ?? '' })}
        onClose={() => setResetLink(null)}
      />
    </div>
  )
}
