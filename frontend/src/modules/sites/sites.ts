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
    enabled: siteId !== '',
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
    enabled: siteId !== '',
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

export type SiteKind = components['schemas']['SiteKind']
export const SITE_KINDS: SiteKind[] = [
  'office',
  'factory',
  'datacenter',
  'warehouse',
  'store',
  'other',
]

// --- category tree (P1-27, ADR-032) ---

export type Category = components['schemas']['Category']
export type CategoryInput = components['schemas']['CategoryInput']
export type SiteCodeChange = components['schemas']['SiteCodeChanges']['changes'][number]

const catKeys = { all: (orgId: string) => ['orgs', orgId, 'categories'] as const }

export function useCategories(orgId: string, enabled = true) {
  return useQuery({
    queryKey: catKeys.all(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/categories', { params: { path: { orgId } } })
      if (r.data) return r.data.categories
      fail(r.error, r.response.status, i18n.t('errors.categoriesLoad'))
    },
  })
}

export interface CategoryNode extends Category {
  children: CategoryNode[]
  depth: number
}

/** The flat list as a tree (roots first, children sorted by name). */
export function buildTree(categories: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>()
  for (const c of categories) byId.set(c.id, { ...c, children: [], depth: 0 })
  const roots: CategoryNode[] = []
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sort = (list: CategoryNode[], depth: number) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    for (const n of list) {
      n.depth = depth
      sort(n.children, depth + 1)
    }
  }
  sort(roots, 0)
  return roots
}

/** Depth-first order with depth, for indented selects. */
export function flattenTree(roots: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = []
  const walk = (list: CategoryNode[]) => {
    for (const n of list) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(roots)
  return out
}

/** A category and all categories below it. */
export function subtreeIds(categories: Category[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of categories)
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id)
        grew = true
      }
  }
  return out
}

/** Full site code as the server will build it: <ORG>-<category codes>-<site code>. */
export function previewSiteCode(
  orgCode: string,
  categories: Category[],
  categoryId: string | null,
  local: string,
): string {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const parts: string[] = []
  for (
    let c = categoryId ? byId.get(categoryId) : undefined;
    c;
    c = c.parentId ? byId.get(c.parentId) : undefined
  )
    parts.unshift(c.code)
  return [orgCode, ...parts, local.trim().toUpperCase() || '…'].join('-')
}

export function useCategoryMutations(orgId: string) {
  const qc = useQueryClient()
  // Category changes may re-code sites (and every list showing a site code).
  const onSettled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: catKeys.all(orgId) }),
      qc.invalidateQueries({ queryKey: keys.sites(orgId) }),
      qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] }),
    ])
  const save = useMutation({
    mutationFn: async (input: { category?: Category; body: CategoryInput; confirm?: boolean }) => {
      const r = input.category
        ? await api.PATCH('/orgs/{orgId}/categories/{categoryId}', {
            params: { ...csrfParam, path: { orgId, categoryId: input.category.id } },
            body: {
              ...input.body,
              version: input.category.version,
              confirmSiteCodes: input.confirm,
            },
          })
        : await api.POST('/orgs/{orgId}/categories', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (categoryId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/categories/{categoryId}', {
        params: { ...csrfParam, path: { orgId, categoryId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { save, remove }
}

/** Site codes an update would change (nothing written). */
export async function previewCategory(orgId: string, category: Category, body: CategoryInput) {
  const r = await api.POST('/orgs/{orgId}/categories/{categoryId}/preview', {
    params: { ...csrfParam, path: { orgId, categoryId: category.id } },
    body: { ...body, version: category.version },
  })
  if (r.data) return r.data.changes
  fail(r.error, r.response.status, i18n.t('errors.save'))
}

export async function previewOrgCode(orgId: string, code: string) {
  const r = await api.GET('/orgs/{orgId}/code-preview', {
    params: { path: { orgId }, query: { code } },
  })
  if (r.data) return r.data.changes
  fail(r.error, r.response.status, i18n.t('errors.save'))
}

/** Next free own site code <PLACE><NN> within a category (null = straight under the organization). */
export async function suggestSiteCode(
  orgId: string,
  categoryId: string | null,
  place: string,
): Promise<string | null> {
  const r = await api.GET('/orgs/{orgId}/sites/next-code', {
    params: { path: { orgId }, query: { place, categoryId: categoryId ?? undefined } },
  })
  return r.data?.code ?? null
}
