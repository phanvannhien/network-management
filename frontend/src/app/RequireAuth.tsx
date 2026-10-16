import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { mfaStep, useSession } from './auth'

/**
 * Route guard: no session → /login; MFA still owed → /mfa (enter code) or /mfa/setup (mandatory
 * enrollment). This is UX only — the backend rejects every request the session may not make (mfaGate).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession()
  const location = useLocation()

  if (session.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Đang tải…</p>
  }
  if (session.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Không kết nối được máy chủ: {session.error.message}
      </p>
    )
  }
  const next = encodeURIComponent(location.pathname + location.search)
  if (!session.data) {
    return <Navigate to={`/login?next=${next}`} replace />
  }
  const step = mfaStep(session.data)
  if (step === 'verify') return <Navigate to={`/mfa?next=${next}`} replace />
  if (step === 'setup') return <Navigate to={`/mfa/setup?next=${next}`} replace />
  return children
}
