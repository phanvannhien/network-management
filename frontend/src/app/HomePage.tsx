import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, type Health } from '../api/client'

// 503 still carries a Health body (database unavailable), so both branches return it.
async function fetchHealth(): Promise<Health> {
  const result = await api.GET('/healthz')
  const status = result.response.status
  if (result.data) return result.data
  if (result.error) return result.error
  // Non-JSON failure (e.g. proxy 502 with empty body).
  throw new Error(`healthz: HTTP ${status}`)
}

/** Temporary landing page; replaced by the app shell + login in P1-01/P1-06. */
export function HomePage() {
  const health = useQuery({ queryKey: ['healthz'], queryFn: fetchHealth, retry: false })

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Network Topology Builder</h1>
      <p className="text-sm" data-testid="api-status">
        API:{' '}
        {health.isPending
          ? 'đang kiểm tra…'
          : health.isError
            ? `không kết nối được (${health.error.message})`
            : `${health.data.status} · ${health.data.version} · DB ${health.data.database}`}
      </p>
      <Link to="/editor" className="text-sm text-primary underline">
        Mở editor sơ đồ (bản đang refactor)
      </Link>
    </main>
  )
}
