import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api, type AuthSession, type Health, type OrganizationView } from '../api/client'
import { useLogout, useMfaDisable, useSession } from './auth'
import { OrgSwitcher } from './OrgSwitcher'
import {
  activateOrganization,
  ConflictError,
  NotFoundError,
  useOrganization,
  useUpdateOrganization,
} from './orgs'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

/** Organization info; owner/admin can rename and edit notes (409 when someone else saved first). */
function OrganizationPanel({ orgId, view }: { orgId: string; view: OrganizationView }) {
  const update = useUpdateOrganization(orgId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(view.organization.name)
  const [notes, setNotes] = useState(view.organization.notes)
  const canAdmin = view.membership.role === 'owner' || view.membership.role === 'admin'

  const startEdit = () => {
    setName(view.organization.name)
    setNotes(view.organization.notes)
    update.reset()
    setEditing(true)
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(
      { name, notes, version: view.organization.version },
      { onSuccess: () => setEditing(false) },
    )
  }

  if (!editing) {
    return (
      <section className="w-full max-w-md space-y-1 rounded-lg border border-border p-4 text-sm">
        <h2 className="text-lg font-semibold">{view.organization.name}</h2>
        <p className="text-muted-foreground">
          {view.organization.kind === 'customer' ? 'Khách hàng' : 'Nội bộ'} · Vai trò của bạn:{' '}
          {ROLE_LABELS[view.membership.role] ?? view.membership.role}
        </p>
        {view.organization.notes && (
          <p className="whitespace-pre-wrap">{view.organization.notes}</p>
        )}
        {canAdmin && (
          <button type="button" onClick={startEdit} className="text-primary underline">
            Sửa thông tin
          </button>
        )}
      </section>
    )
  }
  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-2 rounded-lg border border-border p-4 text-sm"
    >
      <label className="block space-y-1">
        <span className="text-muted-foreground">Tên tổ chức</span>
        <input
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-muted-foreground">Ghi chú</span>
        <textarea
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>
      {update.isError && (
        <p role="alert" className="text-destructive">
          {update.error.message}
          {update.error instanceof ConflictError && ' (dữ liệu bên trên đã là bản mới nhất)'}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
        >
          Lưu
        </button>
        <button type="button" onClick={() => setEditing(false)} className="underline">
          Hủy
        </button>
      </div>
    </form>
  )
}

/** MFA status with enable link, or a disable form for users not required to use MFA. */
function MfaSection({ session }: { session: AuthSession }) {
  const disable = useMfaDisable()
  const [code, setCode] = useState('')
  const { enabled, required } = session.mfa

  if (!enabled) {
    return (
      <p className="text-sm">
        MFA: <span className="text-muted-foreground">chưa bật</span> ·{' '}
        <Link to="/mfa/setup?next=/" className="text-primary underline">
          Bật xác thực hai lớp
        </Link>
      </p>
    )
  }
  if (required) {
    return <p className="text-sm">MFA: đã bật (bắt buộc với tài khoản quản trị)</p>
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    disable.mutate(code, { onSuccess: () => setCode('') })
  }
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 text-sm">
      <span>MFA: đã bật ·</span>
      <input
        aria-label="Mã MFA để tắt"
        placeholder="Mã 6 số"
        inputMode="numeric"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-24 rounded-md border border-border bg-background px-2 py-1"
      />
      <button type="submit" disabled={disable.isPending} className="underline">
        Tắt MFA
      </button>
      {disable.isError && (
        <span role="alert" className="text-destructive">
          {disable.error.message}
        </span>
      )}
    </form>
  )
}

// 503 still carries a Health body (database unavailable), so both branches return it.
async function fetchHealth(): Promise<Health> {
  const result = await api.GET('/healthz')
  const status = result.response.status
  if (result.data) return result.data
  if (result.error) return result.error
  // Non-JSON failure (e.g. proxy 502 with empty body).
  throw new Error(`healthz: HTTP ${status}`)
}

/** Organization landing page /o/:orgId; becomes the dashboard inside the app shell in P1-06. */
export function OrgHomePage() {
  const { orgId = '' } = useParams()
  const health = useQuery({ queryKey: ['healthz'], queryFn: fetchHealth, retry: false })
  const session = useSession()
  const org = useOrganization(orgId)
  const logout = useLogout()
  const user = session.data?.user

  // Remember the last organization opened (default after the next sign-in).
  useEffect(() => {
    if (org.data) activateOrganization(orgId)
  }, [orgId, org.data])

  if (org.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
        <h1 className="text-xl font-semibold">
          {org.error instanceof NotFoundError ? 'Không tìm thấy tổ chức' : 'Lỗi'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {org.error instanceof NotFoundError
            ? 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.'
            : org.error.message}
        </p>
        <Link to="/" className="text-sm text-primary underline">
          Về tổ chức của tôi
        </Link>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Network Topology Builder</h1>
      <OrgSwitcher currentOrgId={orgId} />
      {org.data && (
        <OrganizationPanel key={org.data.organization.version} orgId={orgId} view={org.data} />
      )}
      {user && (
        <p className="text-sm">
          Xin chào <strong>{user.displayName || user.email}</strong>
          {user.isSystemAdmin && <span className="text-muted-foreground"> (system admin)</span>}
        </p>
      )}
      {session.data && <MfaSection session={session.data} />}
      <p className="text-sm" data-testid="api-status">
        API:{' '}
        {health.isPending
          ? 'đang kiểm tra…'
          : health.isError
            ? `không kết nối được (${health.error.message})`
            : `${health.data.status} · ${health.data.version} · DB ${health.data.database}`}
      </p>
      <div className="flex gap-4 text-sm">
        <Link to="/editor" className="text-primary underline">
          Mở editor sơ đồ (bản đang refactor)
        </Link>
        <Link to={`/o/${orgId}/members`} className="text-primary underline">
          Thành viên
        </Link>
        {user?.isSystemAdmin && (
          <>
            <Link to="/admin/organizations" className="text-primary underline">
              Quản trị tổ chức
            </Link>
            <Link to="/admin/users" className="text-primary underline">
              Quản trị người dùng
            </Link>
          </>
        )}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="text-muted-foreground underline hover:text-foreground"
        >
          Đăng xuất
        </button>
      </div>
    </main>
  )
}
