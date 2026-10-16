import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

interface Health {
  status: 'ok'
  version: string
}

// Plain fetch until the generated openapi-fetch client lands in P0-03.
async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/healthz')
  if (!res.ok) throw new Error(`healthz: HTTP ${res.status}`)
  return (await res.json()) as Health
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
            : `${health.data.status} · ${health.data.version}`}
      </p>
      <Link to="/editor" className="text-sm text-primary underline">
        Mở editor sơ đồ (bản đang refactor)
      </Link>
    </main>
  )
}
