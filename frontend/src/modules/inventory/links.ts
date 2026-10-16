import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Links (P1-12, SRS §6.2): connections between devices / endpoint groups, port → port or not yet assigned.

export type Link = components['schemas']['Link']
export type LinkInput = components['schemas']['LinkInput']
export type LinkKind = components['schemas']['LinkKind']
export type LinkStatus = components['schemas']['LinkStatus']
export type LinkEndKind = components['schemas']['LinkEndKind']

export const LINK_KINDS: LinkKind[] = [
  'ethernet',
  'fiber',
  'wireless',
  'serial',
  'logical',
  'console',
]
export const LINK_STATUSES: LinkStatus[] = ['up', 'planned', 'down']

/** Common variants per kind, offered as suggestions (free text is allowed). */
export const LINK_MEDIA: Record<LinkKind, string[]> = {
  ethernet: ['Cat5e', 'Cat6', 'Cat6A'],
  fiber: ['SM', 'MM OM3', 'MM OM4', 'DAC'],
  wireless: ['Wi-Fi 6', 'Wi-Fi 7', 'Bridge P2P'],
  serial: ['V.35', 'RS-232'],
  logical: ['VPN/IPsec', 'GRE', 'MPLS', 'LAG'],
  console: ['Console RJ45', 'USB console'],
}

/** Physical kinds take a physical port; logical ones a virtual interface (ADR-012). */
export function portFits(kind: LinkKind, interfaceKind: string): boolean {
  return kind === 'logical' ? interfaceKind !== 'physical' : interfaceKind === 'physical'
}

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'links'] as const,
  of: (orgId: string, endId: string) => ['orgs', orgId, 'links', endId] as const,
}

export function useLinks(orgId: string, endId: string, enabled = true) {
  return useQuery({
    queryKey: keys.of(orgId, endId),
    enabled: enabled && orgId !== '' && endId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/links', {
        params: { path: { orgId }, query: { endId } },
      })
      if (r.data) return r.data.links
      fail(r.error, r.response.status, i18n.t('errors.linksLoad'))
    },
  })
}

export function useLinkMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: keys.all(orgId) })
  const save = useMutation({
    mutationFn: async (input: { link?: Link; body: LinkInput }) => {
      const r = input.link
        ? await api.PATCH('/orgs/{orgId}/links/{linkId}', {
            params: { ...csrfParam, path: { orgId, linkId: input.link.id } },
            body: { ...input.body, version: input.link.version },
          })
        : await api.POST('/orgs/{orgId}/links', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (linkId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/links/{linkId}', {
        params: { ...csrfParam, path: { orgId, linkId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { save, remove }
}
