import { useQuery } from '@tanstack/react-query'
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

/** Version + environment for the shell and auth pages; detailed status lives in the admin area. */
export function useHealth() {
  return useQuery({
    queryKey: ['healthz'],
    queryFn: fetchHealth,
    retry: false,
    staleTime: 5 * 60_000,
  })
}
