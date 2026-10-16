import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

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
