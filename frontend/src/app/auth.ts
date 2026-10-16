import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setCsrfToken, type AuthSession } from '../api/client'

export const SESSION_QUERY_KEY = ['auth', 'session'] as const

/** Current session, or null when not signed in (401). Network/server errors surface as query errors. */
async function fetchSession(): Promise<AuthSession | null> {
  const result = await api.GET('/auth/me')
  if (result.data) {
    setCsrfToken(result.data.csrfToken)
    return result.data
  }
  if (result.response.status === 401) {
    setCsrfToken(null)
    return null
  }
  throw new Error(`auth/me: HTTP ${result.response.status}`)
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  })
}

export class LoginError extends Error {}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const result = await api.POST('/auth/login', { body: credentials })
      if (result.data) return result.data
      // 401 / 429 carry a user-facing message; anything else is generic.
      const message =
        result.error && 'message' in result.error
          ? result.error.message
          : `Đăng nhập thất bại (HTTP ${result.response.status})`
      throw new LoginError(message)
    },
    onSuccess: (session) => {
      setCsrfToken(session.csrfToken)
      queryClient.setQueryData(SESSION_QUERY_KEY, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // X-CSRF-Token is attached by the client middleware; the header param is required by the spec.
      await api.POST('/auth/logout', { params: { header: { 'X-CSRF-Token': '' } } })
    },
    onSettled: () => {
      setCsrfToken(null)
      queryClient.setQueryData(SESSION_QUERY_KEY, null)
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_QUERY_KEY[0] })
    },
  })
}
