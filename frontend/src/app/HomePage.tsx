import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type AuthSession, type Health } from '../api/client'
import { useLogout, useMfaDisable, useSession } from './auth'

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

/** Temporary landing page; replaced by the app shell in P1-06. */
export function HomePage() {
  const health = useQuery({ queryKey: ['healthz'], queryFn: fetchHealth, retry: false })
  const session = useSession()
  const logout = useLogout()
  const user = session.data?.user

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Network Topology Builder</h1>
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
