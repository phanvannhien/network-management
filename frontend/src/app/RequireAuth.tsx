import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from './auth'

/**
 * Route guard: redirects to /login when there is no session. This is UX only —
 * every API endpoint enforces authentication on the server (CLAUDE.md).
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
  if (!session.data) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return children
}
