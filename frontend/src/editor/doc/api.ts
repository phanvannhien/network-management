import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'
import type { DiagramSave } from './types'

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
