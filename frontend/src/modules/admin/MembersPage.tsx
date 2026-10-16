import { MoreHorizontal, Plus, ShieldCheck, ShieldOff, UserX } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { FormField } from '@/components/FormField'
import { useLocalTable } from '@/components/localTable'
import { NativeSelect } from '@/components/NativeSelect'
import { OneTimeLinkDialog } from '@/components/OneTimeLinkDialog'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  accountLink,
  ALL_PERMISSIONS,
  PERMISSION_KEYS,
  ROLES,
  useAddMember,
  useMembers,
  useRegenerateInvite,
  useRemoveMember,
  useUpdateMember,
  type Member,
  type Permission,
} from './members'

type Role = Member['role']

/** What the current user may do (UI hints mirror the backend rules; the server enforces them). */
interface Abilities {
  isOwner: boolean
  canAdmin: boolean
  canManage: boolean
}

const editableBy = (a: Abilities, m: Member) =>
  a.canManage && (a.isOwner || m.role !== 'owner') && (a.canAdmin || m.role !== 'admin')

const assignableRoles = (a: Abilities) =>
  ROLES.filter((r) => (a.isOwner || r !== 'owner') && (a.canAdmin || r !== 'admin'))

function memberStatus(m: Member) {
  return m.disabled ? 'disabled' : m.pendingInvite ? 'pending' : 'active'
}

const MEMBER_SORT: Record<string, (m: Member) => string | number> = {
  user: (m) => m.displayName || m.email,
  role: (m) => ROLES.indexOf(m.role),
  status: memberStatus,
}

/** Right-hand sheet for role + extra permissions (DESIGN.md §7d: no inline checkboxes per row). */
function EditMemberSheet({
  orgId,
  member,
  abilities,
  onClose,
}: {
  orgId: string
  member: Member | null
  abilities: Abilities
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateMember(orgId)
  const [role, setRole] = useState<Role>(member?.role ?? 'viewer')
  const [permissions, setPermissions] = useState<Permission[]>(member?.permissions ?? [])
  const name = member ? member.displayName || member.email : ''

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!member) return
    update.mutate(
      { userId: member.userId, role, permissions, version: member.version },
      {
        onSuccess: () => {
          toast.success(t('members.saved'))
          onClose()
        },
      },
    )
  }

  return (
    <Sheet open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="data-[side=right]:w-[420px] data-[side=right]:sm:max-w-[420px]">
        <form onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{t('members.editTitle', { name })}</SheetTitle>
            <SheetDescription>{member?.email}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 px-4 text-form">
            <FormField label={t('members.role')}>
              {(f) => (
                <NativeSelect
                  {...f}
                  aria-label={t('members.roleOf', { email: member?.email ?? '' })}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {assignableRoles(abilities).map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">{t('members.extraPermissions')}</legend>
              {ALL_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <Checkbox
                    disabled={!abilities.canAdmin}
                    checked={permissions.includes(p)}
                    onCheckedChange={(on) =>
                      setPermissions(on ? [...permissions, p] : permissions.filter((x) => x !== p))
                    }
                  />
                  {t(PERMISSION_KEYS[p])}
                </label>
              ))}
              <p className="text-label text-muted-foreground">{t('members.editHint')}</p>
            </fieldset>
            {update.isError && (
              <p role="alert" className="text-destructive">
                {update.error.message}
              </p>
            )}
          </div>
          <SheetFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {t('members.saveChanges')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function InviteDialog({
  orgId,
  orgName,
  open,
  abilities,
  onClose,
  onLink,
}: {
  orgId: string
  orgName: string
  open: boolean
  abilities: Abilities
  onClose: () => void
  onLink: (token: string) => void
}) {
  const { t } = useTranslation()
  const add = useAddMember(orgId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      { email, role, permissions: [] },
      {
        onSuccess: (res) => {
          setEmail('')
          onClose()
          if (res.inviteToken) onLink(res.inviteToken)
          else toast.success(t('members.saved'))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4" aria-label={t('members.invite')}>
          <DialogHeader>
            <DialogTitle>{t('members.inviteTitle', { org: orgName })}</DialogTitle>
            <DialogDescription>{t('members.inviteHint')}</DialogDescription>
          </DialogHeader>
          <FormField label={t('members.email')} required>
            {(f) => (
              <Input
                {...f}
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('members.role')}>
            {(f) => (
              <NativeSelect {...f} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {assignableRoles(abilities).map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {add.isError && (
            <p role="alert" className="text-destructive">
              {add.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {t('members.sendInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Organization members (P1-04): list, invite, change role/permissions in a sheet, remove. */
export function MembersPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const session = useSession()
  const org = useOrganization(orgId)
  const members = useMembers(orgId)
  const remove = useRemoveMember(orgId)
  const regen = useRegenerateInvite(orgId)
  const myId = session.data?.user.id ?? ''
  const orgName = org.data?.organization.name ?? ''
  useBreadcrumbs([{ label: t('nav.admin') }, { label: t('members.title') }])

  const [params] = useSearchParams()
  // ?q= preselects a search (e.g. from Ctrl+K → member).
  const [filter, setFilter] = useState<FilterState>({ ...emptyFilter, q: params.get('q') ?? '' })
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [link, setLink] = useState<string | null>(null)

  const my = org.data?.membership
  const isOwner = my?.role === 'owner'
  const canAdmin = isOwner || my?.role === 'admin'
  const abilities: Abilities = {
    isOwner,
    canAdmin,
    canManage: canAdmin || (my?.permissions.includes('user.manage') ?? false),
  }

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    const roles = filter.facets.role ?? []
    const statuses = filter.facets.status ?? []
    return members.data?.filter(
      (m) =>
        (!q || m.email.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)) &&
        (roles.length === 0 || roles.includes(m.role)) &&
        (statuses.length === 0 || statuses.includes(memberStatus(m))),
    )
  }, [members.data, filter])
  const table = useLocalTable(filtered, MEMBER_SORT, [{ id: 'user', desc: false }])

  const count = (pred: (m: Member) => boolean) => members.data?.filter(pred).length ?? 0
  const facets = [
    {
      id: 'role',
      label: t('members.role'),
      options: ROLES.map((r) => ({
        value: r,
        label: t(`roles.${r}`),
        count: count((m) => m.role === r),
      })),
    },
    {
      id: 'status',
      label: t('members.status'),
      options: (['active', 'pending', 'disabled'] as const).map((s) => ({
        value: s,
        label: t(`members.${s}`),
        count: count((m) => memberStatus(m) === s),
      })),
    },
  ]

  const columns: DataColumn<Member>[] = [
    {
      id: 'user',
      accessorFn: (m) => m.displayName || m.email,
      header: t('members.user'),
      meta: { label: t('members.user'), width: 280, pin: true, alwaysVisible: true },
      cell: ({ row: { original: m } }) => (
        <div className="leading-tight">
          <span className="font-medium">
            {m.displayName || (
              <span className="text-muted-foreground">{t('members.notActivated')}</span>
            )}
          </span>
          {m.userId === myId && (
            <span className="text-muted-foreground"> ({t('members.you')})</span>
          )}
          <div className="text-label text-muted-foreground">{m.email}</div>
        </div>
      ),
    },
    {
      id: 'role',
      accessorKey: 'role',
      header: t('members.role'),
      meta: { label: t('members.role'), width: 120 },
      cell: ({ row }) => t(`roles.${row.original.role}`),
    },
    {
      id: 'permissions',
      header: t('members.extraPermissions'),
      enableSorting: false,
      meta: { label: t('members.extraPermissions'), width: 280 },
      cell: ({ row }) =>
        row.original.permissions.length ? (
          row.original.permissions.map((p) => t(PERMISSION_KEYS[p])).join(', ')
        ) : (
          <span className="text-muted-foreground">{t('common.none')}</span>
        ),
    },
    {
      id: 'mfa',
      header: t('members.mfa'),
      enableSorting: false,
      meta: { label: t('members.mfa'), width: 90 },
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
      accessorFn: memberStatus,
      header: t('members.status'),
      meta: { label: t('members.status'), width: 150 },
      cell: ({ row }) => {
        const s = memberStatus(row.original)
        return (
          <StatusBadge
            status={s === 'active' ? 'up' : s === 'pending' ? 'planned' : 'notMonitored'}
            label={t(`members.${s}`)}
          />
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('common.more')}</span>,
      enableSorting: false,
      meta: { label: t('common.more'), width: 48, alwaysVisible: true, align: 'right' },
      cell: ({ row: { original: m } }) => {
        const isMe = m.userId === myId
        const editable = editableBy(abilities, m)
        if (!isMe && !editable && !(abilities.canManage && m.pendingInvite)) return null
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('table.rowActions', { name: m.email })}
                />
              }
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {editable && (
                <DropdownMenuItem onClick={() => setEditing(m)}>
                  {t('members.edit')}
                </DropdownMenuItem>
              )}
              {abilities.canManage && m.pendingInvite && (
                <DropdownMenuItem onClick={() => regen.mutate(m.userId, { onSuccess: setLink })}>
                  {t('members.newInviteLink')}
                </DropdownMenuItem>
              )}
              {(isMe || editable) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setRemoving(m)}>
                    {isMe ? t('members.leave') : t('members.remove')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const error = remove.error ?? regen.error
  const leaving = removing?.userId === myId

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('members.title')}
        count={members.data?.length}
        actions={
          abilities.canManage && (
            <Button onClick={() => setInviting(true)}>
              <Plus aria-hidden /> {t('members.invite')}
            </Button>
          )
        }
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      <DataTable
        tableId="members"
        userId={myId}
        caption={t('members.title')}
        columns={columns}
        data={table.data}
        total={table.total}
        isLoading={members.isPending}
        error={members.error}
        getRowId={(m) => m.userId}
        rowLabel={(m) => m.email}
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
            facets={facets}
            searchPlaceholder={t('members.searchPlaceholder')}
            storageKey={`ntb-filters:${myId}:members`}
          />
        }
        empty={<EmptyState icon={<UserX />} title={t('members.emptyTitle')} />}
      />

      <InviteDialog
        orgId={orgId}
        orgName={orgName}
        open={inviting}
        abilities={abilities}
        onClose={() => setInviting(false)}
        onLink={setLink}
      />
      <EditMemberSheet
        key={editing ? `${editing.userId}:${editing.version}` : 'none'}
        orgId={orgId}
        member={editing}
        abilities={abilities}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={
          leaving
            ? t('members.leaveTitle', { org: orgName })
            : t('members.removeTitle', { email: removing?.email ?? '' })
        }
        description={leaving ? t('members.leaveBody') : t('members.removeBody', { org: orgName })}
        confirmLabel={leaving ? t('members.leave') : t('members.remove')}
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.userId)
          setRemoving(null)
        }}
      />
      <OneTimeLinkDialog
        link={link ? accountLink(link) : null}
        title={t('members.linkTitle')}
        description={t('members.linkBody')}
        onClose={() => setLink(null)}
      />
    </div>
  )
}
