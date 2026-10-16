import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema'

export type { components }

/**
 * Typed API client generated from api/openapi.yaml (ADR-017). Paths, params and
 * response bodies are checked at compile time; regenerate with `make gen`.
 */
export const api = createClient<paths>({
  // Absolute URL on the page's own origin: Request() outside a browser rejects relative URLs.
  baseUrl: new URL('/api', globalThis.location?.origin ?? 'http://localhost').href,
  // Resolve fetch per call (not at module load) so tests can stub globalThis.fetch.
  fetch: (request) => globalThis.fetch(request),
})

export type Health = components['schemas']['Health']
export type OrganizationSummary = components['schemas']['OrganizationSummary']
export type OrganizationView = components['schemas']['OrganizationView']
export type AdminOrganization = components['schemas']['AdminOrganization']
export type OrganizationKind = components['schemas']['OrganizationKind']
export type Role = components['schemas']['Role']

/** Extracts the server's user-facing message from an openapi-fetch error result. */
export function errorMessage(error: unknown, status: number, fallback: string): string {
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

/** The CSRF header param is required by the spec; the client middleware fills in the real token. */
export const csrfParam = { header: { 'X-CSRF-Token': '' } }
export type AuthSession = components['schemas']['AuthSession']
export type CurrentUser = components['schemas']['CurrentUser']

// CSRF token from /auth/login or /auth/me, attached to every state-changing request (SRS §14).
let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      request.headers.set('X-CSRF-Token', csrfToken)
    }
    return request
  },
}

api.use(csrfMiddleware)
