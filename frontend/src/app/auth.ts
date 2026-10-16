import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setCsrfToken, type AuthSession } from '../api/client'

export const SESSION_QUERY_KEY = ['auth', 'session'] as const

export type MfaStep = 'ok' | 'verify' | 'setup'

/** What the session still owes before the app is usable (mirrors the backend mfaGate, ADR-019). */
export function mfaStep(session: AuthSession): MfaStep {
  const { enabled, verified, required } = session.mfa
  if (enabled && !verified) return 'verify'
  if (!enabled && required) return 'setup'
  return 'ok'
}

/** Extracts the server's user-facing message from an openapi-fetch error result. */
function errorMessage(error: unknown, status: number, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return `${fallback} (HTTP ${status})`
}

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
      throw new LoginError(errorMessage(result.error, result.response.status, 'Đăng nhập thất bại'))
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
      await api.POST('/auth/logout', { params: csrfParam })
    },
    onSettled: () => {
      setCsrfToken(null)
      queryClient.setQueryData(SESSION_QUERY_KEY, null)
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_QUERY_KEY[0] })
    },
  })
}

// The CSRF header param is required by the spec; the client middleware fills in the real token.
const csrfParam = { header: { 'X-CSRF-Token': '' } }

export function useMfaVerify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code?: string; recoveryCode?: string }) => {
      const result = await api.POST('/auth/mfa/verify', { params: csrfParam, body: input })
      if (result.data) return result.data
      throw new Error(errorMessage(result.error, result.response.status, 'Xác thực thất bại'))
    },
    onSuccess: (session) => queryClient.setQueryData(SESSION_QUERY_KEY, session),
  })
}

export function useMfaSetup() {
  return useMutation({
    mutationFn: async () => {
      const result = await api.POST('/auth/mfa/setup', { params: csrfParam })
      if (result.data) return result.data
      throw new Error(
        errorMessage(result.error, result.response.status, 'Không bắt đầu được thiết lập MFA'),
      )
    },
  })
}

export function useMfaEnable() {
  return useMutation({
    mutationFn: async (code: string) => {
      const result = await api.POST('/auth/mfa/enable', { params: csrfParam, body: { code } })
      if (result.data) return result.data.recoveryCodes
      throw new Error(errorMessage(result.error, result.response.status, 'Không bật được MFA'))
    },
    // Session state is refreshed when the user leaves the recovery-code screen (not here), so the
    // route guard does not navigate away before the codes have been saved.
  })
}

export function useMfaDisable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const result = await api.POST('/auth/mfa/disable', { params: csrfParam, body: { code } })
      if (result.response.status === 204) return
      throw new Error(errorMessage(result.error, result.response.status, 'Không tắt được MFA'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  })
}
