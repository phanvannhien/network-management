import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'
import { linkCard, type DiagramSave, type LinkCard } from './types'

// Diagram API hooks (P1-13).

export type DiagramInput = components['schemas']['DiagramInput']
export type DiagramLayer = components['schemas']['DiagramLayer']

export const DIAGRAM_LAYERS: DiagramLayer[] = ['physical', 'l2', 'l3', 'overview']

/** Thrown on 409 so the editor can show the conflict state. */
export class ConflictError extends Error {}

function fail(error: unknown, status: number, fallback: string): never {
  const msg = errorMessage(error, status, fallback)
  throw status === 409 ? new ConflictError(msg) : new Error(msg)
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'diagrams'] as const,
  one: (orgId: string, id: string) => ['orgs', orgId, 'diagrams', id] as const,
}

export function useDiagrams(orgId: string) {
  return useQuery({
    queryKey: keys.all(orgId),
    enabled: orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/diagrams', { params: { path: { orgId } } })
      if (r.data) return r.data.diagrams
      fail(r.error, r.response.status, i18n.t('errors.diagramsLoad'))
    },
  })
}

export function useDiagram(orgId: string, diagramId: string) {
  return useQuery({
    queryKey: keys.one(orgId, diagramId),
    retry: false,
    // The editor owns the document once loaded; refetching would overwrite unsaved work.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/diagrams/{diagramId}', {
        params: { path: { orgId, diagramId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.diagramsLoad'))
    },
  })
}

export async function fetchDiagram(orgId: string, diagramId: string) {
  const r = await api.GET('/orgs/{orgId}/diagrams/{diagramId}', {
    params: { path: { orgId, diagramId } },
  })
  if (r.data) return r.data
  fail(r.error, r.response.status, i18n.t('errors.diagramsLoad'))
}

export function useDiagramMutations(orgId: string) {
  const qc = useQueryClient()
  const invalidateList = () => qc.invalidateQueries({ queryKey: keys.all(orgId), exact: true })
  const create = useMutation({
    mutationFn: async (body: DiagramInput) => {
      const r = await api.POST('/orgs/{orgId}/diagrams', {
        params: { ...csrfParam, path: { orgId } },
        body,
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidateList,
  })
  const remove = useMutation({
    mutationFn: async (diagramId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/diagrams/{diagramId}', {
        params: { ...csrfParam, path: { orgId, diagramId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidateList,
  })
  const save = useMutation({
    mutationFn: async (input: { diagramId: string; body: DiagramSave }) => {
      const r = await api.POST('/orgs/{orgId}/diagrams/{diagramId}/save', {
        params: { ...csrfParam, path: { orgId, diagramId: input.diagramId } },
        body: input.body,
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSuccess: () =>
      Promise.all([
        invalidateList(),
        // Saves may create / delete devices and links.
        qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] }),
        qc.invalidateQueries({ queryKey: ['orgs', orgId, 'links'] }),
      ]),
  })
  return { create, remove, save }
}

/** Inventory links of an object, so placing it on a diagram also draws its cables to what is already there. */
export async function fetchLinkCards(orgId: string, endId: string): Promise<LinkCard[]> {
  return (await fetchLinks(orgId, endId)).map(linkCard)
}

export type DeviceDeleteImpact = components['schemas']['DeviceDeleteImpact']

/** What deleting saved devices takes along (ADR-033): all their cables, other diagrams, clusters, IPs. */
export function useDeleteImpact(orgId: string, deviceIds: string[]) {
  return useQuery({
    queryKey: ['orgs', orgId, 'delete-impact', [...deviceIds].sort()],
    enabled: orgId !== '' && deviceIds.length > 0,
    queryFn: async () => {
      const r = await api.POST('/orgs/{orgId}/devices/delete-impact', {
        params: { ...csrfParam, path: { orgId } },
        body: { ids: deviceIds },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
  })
}

/** Full inventory records of an object's cables (for cloning them). */
export async function fetchLinks(orgId: string, endId: string) {
  const r = await api.GET('/orgs/{orgId}/links', { params: { path: { orgId }, query: { endId } } })
  if (r.data) return r.data.links
  fail(r.error, r.response.status, i18n.t('errors.linksLoad'))
}

/** A saved device, to clone it. */
export async function fetchDevice(orgId: string, deviceId: string) {
  const r = await api.GET('/orgs/{orgId}/devices/{deviceId}', {
    params: { path: { orgId, deviceId } },
  })
  if (r.data) return r.data
  fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
}

/** Hostnames in the inventory starting with a stem, for renaming clones. */
export async function fetchHostnames(orgId: string, q: string): Promise<string[]> {
  const r = await api.GET('/orgs/{orgId}/devices', {
    params: { path: { orgId }, query: { q, pageSize: 200 } },
  })
  if (r.data) return r.data.devices.map((d) => d.hostname)
  // A missed name would make the whole save fail on a duplicate hostname: stop here instead.
  fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
}

/** Organization templates (port groups), to give clones the ports their template will generate. */
export async function fetchTemplates(orgId: string) {
  const r = await api.GET('/orgs/{orgId}/device-templates', { params: { path: { orgId } } })
  if (r.data) return r.data.templates
  fail(r.error, r.response.status, i18n.t('errors.templatesLoad'))
}
