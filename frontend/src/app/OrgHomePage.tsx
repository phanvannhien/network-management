import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { PageHeader } from '@/components/PageHeader'
import { type AuthSession, type OrganizationView } from '../api/client'
import { useMfaDisable, useSession } from './auth'
import { NotFoundPage } from './NotFoundPage'
import { ConflictError, NotFoundError, useOrganization, useUpdateOrganization } from './orgs'

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
        <h2 className="text-sm font-semibold">{view.organization.name}</h2>
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

/**
 * Organization landing page /o/:orgId inside the AppShell; becomes the dashboard in P1-06
 * (content restyled in UI step 3). Health moved to the system area (DESIGN.md §6).
 */
export function OrgHomePage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const session = useSession()
  const org = useOrganization(orgId)
  const user = session.data?.user
  useBreadcrumbs([{ label: t('nav.dashboard') }])

  if (org.isError) {
    if (org.error instanceof NotFoundError) return <NotFoundPage inShell />
    return (
      <p role="alert" className="p-4 text-destructive">
        {org.error.message}
      </p>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader title={t('nav.dashboard')} />
      {org.data && (
        <OrganizationPanel key={org.data.organization.version} orgId={orgId} view={org.data} />
      )}
      {user && (
        <p>
          Xin chào <strong>{user.displayName || user.email}</strong>
          {user.isSystemAdmin && <span className="text-muted-foreground"> (system admin)</span>}
        </p>
      )}
      {session.data && <MfaSection session={session.data} />}
    </div>
  )
}
