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

export type BusinessUnit = components['schemas']['BusinessUnit']
export type BusinessUnitInput = components['schemas']['BusinessUnitInput']
export type SiteKind = components['schemas']['SiteKind']
export const SITE_KINDS: SiteKind[] = [
  'office',
  'factory',
  'datacenter',
  'warehouse',
  'store',
  'other',
]
export const UNIT_RELATIONS = ['subsidiary', 'partner', 'customer'] as const

const unitKeys = {
  all: (orgId: string) => ['orgs', orgId, 'business-units'] as const,
  one: (orgId: string, id: string) => ['orgs', orgId, 'business-units', id] as const,
}

export function useBusinessUnits(orgId: string, enabled = true) {
  return useQuery({
    queryKey: unitKeys.all(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/business-units', { params: { path: { orgId } } })
      if (r.data) return r.data.businessUnits
      fail(r.error, r.response.status, i18n.t('errors.unitsLoad'))
    },
  })
}

export function useBusinessUnit(orgId: string, unitId: string) {
  return useQuery({
    queryKey: unitKeys.one(orgId, unitId),
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/business-units/{businessUnitId}', {
        params: { path: { orgId, businessUnitId: unitId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.unitsLoad'))
    },
  })
}

/** Unit changes rename site codes (ADR-030), so sites are refreshed too. */
function useInvalidateUnits(orgId: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: unitKeys.all(orgId) }),
      qc.invalidateQueries({ queryKey: keys.sites(orgId) }),
    ])
}

export function useSaveUnit(orgId: string) {
  const invalidate = useInvalidateUnits(orgId)
  return useMutation({
    mutationFn: async (input: { unit?: BusinessUnit; body: BusinessUnitInput }) => {
      const r = input.unit
        ? await api.PATCH('/orgs/{orgId}/business-units/{businessUnitId}', {
            params: { ...csrfParam, path: { orgId, businessUnitId: input.unit.id } },
            body: { ...input.body, version: input.unit.version },
          })
        : await api.POST('/orgs/{orgId}/business-units', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
}

export function useDeleteUnit(orgId: string) {
  const invalidate = useInvalidateUnits(orgId)
  return useMutation({
    mutationFn: async (unitId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/business-units/{businessUnitId}', {
        params: { ...csrfParam, path: { orgId, businessUnitId: unitId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
}

/** Next free site code for a unit (or shared) and place — ADR-030. */
export async function suggestSiteCode(
  orgId: string,
  businessUnitId: string | null,
  place: string,
): Promise<string | null> {
  const r = await api.GET('/orgs/{orgId}/sites/next-code', {
    params: { path: { orgId }, query: { place, businessUnitId: businessUnitId ?? undefined } },
  })
  return r.data?.code ?? null
}

/** Client-side check mirroring the server rule (the server stays authoritative). */
export function siteCodeError(code: string, unitCode: string | null): 'format' | 'prefix' | null {
  const m = /^([A-Z][A-Z0-9]{1,7})-([A-Z]{2,4})([0-9]{2})$/.exec(code.toUpperCase())
  if (!m) return 'format'
  return m[1] === (unitCode ?? 'SHARED') ? null : 'prefix'
}
