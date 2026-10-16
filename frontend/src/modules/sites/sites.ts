import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

export type Site = components['schemas']['Site']
export type SiteInput = components['schemas']['SiteInput']
export type Location = components['schemas']['Location']
export type LocationKind = components['schemas']['LocationKind']
export type Rack = components['schemas']['Rack']

/** HTTP 409 (stale version, duplicate name/code, non-empty container): the message explains it. */
export class ConflictError extends Error {}

const keys = {
  sites: (orgId: string) => ['orgs', orgId, 'sites'] as const,
  site: (orgId: string, siteId: string) => ['orgs', orgId, 'sites', siteId] as const,
  locations: (orgId: string, siteId: string) =>
    ['orgs', orgId, 'sites', siteId, 'locations'] as const,
  racks: (orgId: string, siteId: string) => ['orgs', orgId, 'sites', siteId, 'racks'] as const,
}

function fail(error: unknown, status: number, fallback: string): never {
  const message = errorMessage(error, status, fallback)
  throw status === 409 ? new ConflictError(message) : new Error(message)
}

export function useSites(orgId: string, enabled = true) {
  return useQuery({
    queryKey: keys.sites(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/sites', { params: { path: { orgId } } })
      if (r.data) return r.data.sites
      fail(r.error, r.response.status, i18n.t('errors.sitesLoad'))
    },
  })
}

export function useSite(orgId: string, siteId: string) {
  return useQuery({
    queryKey: keys.site(orgId, siteId),
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/sites/{siteId}', {
        params: { path: { orgId, siteId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.siteLoad'))
    },
  })
}

/** Invalidates everything under the organization's sites (counts change with locations/racks). */
function useInvalidateSites(orgId: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: keys.sites(orgId) })
}

export function useSaveSite(orgId: string) {
  const invalidate = useInvalidateSites(orgId)
  return useMutation({
    mutationFn: async (input: { siteId?: string; body: SiteInput; version?: number }) => {
      const r = input.siteId
        ? await api.PATCH('/orgs/{orgId}/sites/{siteId}', {
            params: { ...csrfParam, path: { orgId, siteId: input.siteId } },
            body: { ...input.body, version: input.version ?? 0 },
          })
        : await api.POST('/orgs/{orgId}/sites', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
}

export function useDeleteSite(orgId: string) {
  const invalidate = useInvalidateSites(orgId)
  return useMutation({
    mutationFn: async (siteId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/sites/{siteId}', {
        params: { ...csrfParam, path: { orgId, siteId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
}

export function useLocations(orgId: string, siteId: string) {
  return useQuery({
    queryKey: keys.locations(orgId, siteId),
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/sites/{siteId}/locations', {
        params: { path: { orgId, siteId } },
      })
      if (r.data) return r.data.locations
      fail(r.error, r.response.status, i18n.t('errors.siteLoad'))
    },
  })
}

export function useLocationMutations(orgId: string, siteId: string) {
  const invalidate = useInvalidateSites(orgId)
  const path = { orgId, siteId }
  const create = useMutation({
    mutationFn: async (body: { kind: LocationKind; name: string; parentId: string | null }) => {
      const r = await api.POST('/orgs/{orgId}/sites/{siteId}/locations', {
        params: { ...csrfParam, path },
        body,
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const rename = useMutation({
    mutationFn: async ({ location, name }: { location: Location; name: string }) => {
      const r = await api.PATCH('/orgs/{orgId}/sites/{siteId}/locations/{locationId}', {
        params: { ...csrfParam, path: { ...path, locationId: location.id } },
        body: { name, sortOrder: location.sortOrder, version: location.version },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (locationId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/sites/{siteId}/locations/{locationId}', {
        params: { ...csrfParam, path: { ...path, locationId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
  return { create, rename, remove }
}

export function useRacks(orgId: string, siteId: string) {
  return useQuery({
    queryKey: keys.racks(orgId, siteId),
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/sites/{siteId}/racks', {
        params: { path: { orgId, siteId } },
      })
      if (r.data) return r.data.racks
      fail(r.error, r.response.status, i18n.t('errors.siteLoad'))
    },
  })
}

export function useRackMutations(orgId: string, siteId: string) {
  const invalidate = useInvalidateSites(orgId)
  const path = { orgId, siteId }
  const save = useMutation({
    mutationFn: async (input: {
      rack?: Rack
      body: { locationId: string; name: string; uHeight: number; notes: string }
    }) => {
      const r = input.rack
        ? await api.PATCH('/orgs/{orgId}/sites/{siteId}/racks/{rackId}', {
            params: { ...csrfParam, path: { ...path, rackId: input.rack.id } },
            body: { ...input.body, version: input.rack.version },
          })
        : await api.POST('/orgs/{orgId}/sites/{siteId}/racks', {
            params: { ...csrfParam, path },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (rackId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/sites/{siteId}/racks/{rackId}', {
        params: { ...csrfParam, path: { ...path, rackId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
  return { save, remove }
}

/** Children allowed under a parent kind (null = directly under the site) — mirrors ADR-025 / the API. */
export function childKinds(parent: LocationKind | null): LocationKind[] {
  if (parent === null) return ['building', 'floor', 'room']
  if (parent === 'building') return ['floor', 'room']
  if (parent === 'floor') return ['room']
  return []
}

/** "Tòa A › Tầng 3 › Phòng máy chủ" for a location id. */
export function locationPath(locations: Location[], id: string): string {
  const byId = new Map(locations.map((l) => [l.id, l]))
  const parts: string[] = []
  for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
    parts.unshift(cur.name)
  return parts.join(' › ')
}
