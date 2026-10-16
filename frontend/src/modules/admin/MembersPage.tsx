import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useSession } from '../../app/auth'
import { useOrganization } from '../../app/orgs'
import {
  accountLink,
  PERMISSION_LABELS,
  ROLE_OPTIONS,
  useAddMember,
  useMembers,
  useRegenerateInvite,
  useRemoveMember,
  useUpdateMember,
  type Member,
  type Permission,
} from './members'

const inputClass = 'rounded-md border border-border bg-background px-2 py-1'
const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[]

/** Shows a freshly issued one-time link once, with a copy button. */
function LinkNotice({ token, onClose }: { token: string; onClose: () => void }) {
  const link = accountLink(token)
  return (
    <div role="status" className="space-y-2 rounded-md border border-border bg-muted p-3">
      <p>
        Gửi link này cho người được mời (dùng một lần, hết hạn sau 7 ngày). Link chỉ hiện lúc này:
      </p>
      <code className="block break-all font-mono text-xs">{link}</code>
      <div className="flex gap-3">
        <button
          type="button"
          className="underline"
          onClick={() => void navigator.clipboard?.writeText(link)}
        >
          Sao chép
        </button>
        <button type="button" className="underline" onClick={onClose}>
          Đóng
        </button>
      </div>
    </div>
  )
}

function MemberRow({
  orgId,
  member,
  canManage,
  canAdmin,
  isOwner,
  isMe,
  onLink,
}: {
  orgId: string
  member: Member
  canManage: boolean
  canAdmin: boolean
  isOwner: boolean
  isMe: boolean
  onLink: (token: string) => void
}) {
  const update = useUpdateMember(orgId)
  const remove = useRemoveMember(orgId)
  const regen = useRegenerateInvite(orgId)
  const error = update.error ?? remove.error ?? regen.error
  // UI hints mirror the backend rules (the server enforces them regardless).
  const editable =
    canManage && (isOwner || member.role !== 'owner') && (canAdmin || member.role !== 'admin')

  const save = (role: Member['role'], permissions: Permission[]) =>
    update.mutate({ userId: member.userId, role, permissions, version: member.version })

  return (
    <tr className="border-b border-border align-top">
      <td className="py-2">
        <div>
          {member.displayName || <span className="text-muted-foreground">(chưa kích hoạt)</span>}
        </div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
        {error && (
          <div role="alert" className="text-xs text-destructive">
            {error.message}
          </div>
        )}
      </td>
      <td>
        {editable ? (
          <select
            aria-label={`Vai trò của ${member.email}`}
            value={member.role}
            onChange={(e) => save(e.target.value as Member['role'], member.permissions)}
            className={inputClass}
          >
            {ROLE_OPTIONS.filter((o) => isOwner || o.value !== 'owner')
              .filter((o) => canAdmin || o.value !== 'admin')
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        ) : (
          ROLE_OPTIONS.find((o) => o.value === member.role)?.label
        )}
      </td>
      <td className="space-y-1">
        {ALL_PERMISSIONS.map((p) => (
          <label key={p} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              disabled={!canAdmin || !editable}
              checked={member.permissions.includes(p)}
              onChange={(e) =>
                save(
                  member.role,
                  e.target.checked
                    ? [...member.permissions, p]
                    : member.permissions.filter((x) => x !== p),
                )
              }
            />
            {PERMISSION_LABELS[p]}
          </label>
        ))}
      </td>
      <td className="text-xs">
        {member.disabled
          ? 'Đã vô hiệu hóa'
          : member.pendingInvite
            ? 'Chờ kích hoạt'
            : member.mfaEnabled
              ? 'MFA bật'
              : 'MFA tắt'}
      </td>
      <td className="space-y-1 text-right text-xs">
        {canManage && member.pendingInvite && (
          <button
            type="button"
            className="block w-full text-right underline"
            onClick={() => regen.mutate(member.userId, { onSuccess: onLink })}
          >
            Tạo link mời mới
          </button>
        )}
        {(isMe || editable) && (
          <button
            type="button"
            className="block w-full text-right text-destructive underline"
            onClick={() => {
              if (
                window.confirm(isMe ? 'Rời khỏi tổ chức này?' : `Gỡ ${member.email} khỏi tổ chức?`)
              )
                remove.mutate(member.userId)
            }}
          >
            {isMe ? 'Rời tổ chức' : 'Gỡ'}
          </button>
        )}
      </td>
    </tr>
  )
}

/** Organization members (P1-04): list, add/invite, change role and extra permissions, remove. */
export function MembersPage() {
  const { orgId = '' } = useParams()
  const session = useSession()
  const org = useOrganization(orgId)
  const members = useMembers(orgId)
  const add = useAddMember(orgId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('viewer')
  const [link, setLink] = useState<string | null>(null)

  const my = org.data?.membership
  const isOwner = my?.role === 'owner'
  const canAdmin = isOwner || my?.role === 'admin'
  const canManage = canAdmin || (my?.permissions.includes('user.manage') ?? false)

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      { email, role, permissions: [] },
      {
        onSuccess: (res) => {
          setEmail('')
          if (res.inviteToken) setLink(res.inviteToken)
        },
      },
    )
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 text-sm text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Thành viên · {org.data?.organization.name}</h1>
        <Link to={`/o/${orgId}`} className="text-primary underline">
          Về tổ chức
        </Link>
      </div>

      {canManage && (
        <form
          onSubmit={onAdd}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-4"
          aria-label="Thêm thành viên"
        >
          <label className="space-y-1">
            <span className="block text-muted-foreground">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-muted-foreground">Vai trò</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Member['role'])}
              className={inputClass}
            >
              {ROLE_OPTIONS.filter((o) => isOwner || o.value !== 'owner')
                .filter((o) => canAdmin || o.value !== 'admin')
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={add.isPending}
            className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
          >
            Thêm
          </button>
          {add.isError && (
            <p role="alert" className="w-full text-destructive">
              {add.error.message}
            </p>
          )}
        </form>
      )}
      {link && <LinkNotice token={link} onClose={() => setLink(null)} />}

      {members.isError && (
        <p role="alert" className="text-destructive">
          {members.error.message}
        </p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">Người dùng</th>
            <th>Vai trò</th>
            <th>Quyền bổ sung</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => (
            <MemberRow
              key={`${m.userId}:${m.version}`}
              orgId={orgId}
              member={m}
              canManage={canManage}
              canAdmin={canAdmin}
              isOwner={isOwner}
              isMe={m.userId === session.data?.user.id}
              onLink={setLink}
            />
          ))}
        </tbody>
      </table>
    </main>
  )
}
