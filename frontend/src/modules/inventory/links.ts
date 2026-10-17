import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Links (P1-12, SRS §6.2): connections between devices / endpoint groups, port → port or not yet assigned.

export type Link = components['schemas']['Link']
export type LinkInput = components['schemas']['LinkInput']
export type LinkKind = components['schemas']['LinkKind']
export type LinkStatus = components['schemas']['LinkStatus']
export type LinkEndKind = components['schemas']['LinkEndKind']

export type LinkFiberMode = components['schemas']['LinkFiberMode']
export type LinkConnector = components['schemas']['LinkConnector']
export type LinkService = components['schemas']['LinkService']

/** Kinds in the order engineers meet them (ADR-033). */
export const LINK_KINDS: LinkKind[] = [
  'ethernet',
  'fiber',
  'wireless',
  'stack',
  'power',
  'dsl',
  'cellular',
  'console',
  'serial',
  'logical',
]
export const LINK_STATUSES: LinkStatus[] = ['up', 'planned', 'down']
export const FIBER_MODES: LinkFiberMode[] = ['', 'sm', 'mm']
export const CONNECTORS: LinkConnector[] = ['', 'LC', 'SC', 'MPO', 'ST']
export const LINK_SERVICES: LinkService[] = [
  '',
  'internet_broadband',
  'internet_dedicated',
  'mpls',
  'leased_line',
  'metro',
  'mobile',
  'other',
]

/** Common variants per kind, offered as suggestions (free text is allowed). */
export const LINK_MEDIA: Record<LinkKind, string[]> = {
  ethernet: ['Cat5e', 'Cat6', 'Cat6A', 'DAC'],
  fiber: ['OM3', 'OM4', 'OM5', 'OS2', 'AOC'],
  wireless: ['Wi-Fi 6', 'Wi-Fi 7', 'Bridge P2P', 'Bridge P2MP'],
  stack: ['Stack cable', 'HA heartbeat'],
  power: ['C13/C14', 'C19/C20', 'Schuko'],
  dsl: ['VDSL2', 'ADSL2+', 'Coax'],
  cellular: ['4G', '5G', 'Satellite'],
  console: ['Console RJ45', 'USB console'],
  serial: ['V.35', 'RS-232'],
  logical: ['VPN/IPsec', 'GRE', 'SSL VPN'],
}

const SFP_FAMILY = ['SFP', 'SFP+', 'SFP28', 'QSFP']
/** Port media each kind can physically plug into ('' = unknown, always accepted); mirrors the API (ADR-033). */
const KIND_MEDIA: Record<LinkKind, string[] | null> = {
  ethernet: ['RJ45', ...SFP_FAMILY],
  fiber: ['PON', ...SFP_FAMILY],
  wireless: ['Radio'],
  stack: ['RJ45', ...SFP_FAMILY],
  power: [],
  dsl: ['xDSL', 'RJ45'],
  cellular: ['Cellular'],
  console: ['Console', 'RJ45'],
  serial: ['Serial', 'RJ45'],
  logical: null,
}

/**
 * Whether a port can take this kind of link (ADR-033): a LAG is never cabled directly (draw its member cables);
 * logical links use virtual interfaces or the physical port a VPN is bound to; other kinds need a physical port whose
 * media fits.
 */
export function portFits(kind: LinkKind, interfaceKind: string, media = ''): boolean {
  if (interfaceKind === 'lag') return false
  const allowed = KIND_MEDIA[kind]
  if (allowed === null) return true
  if (interfaceKind !== 'physical') return false
  return media === '' || allowed.includes(media)
}

/** Kinds that leave the port free for more links: a radio serves many clients, cellular has no cable. */
export function sharesPort(kind: LinkKind, media = ''): boolean {
  return kind === 'logical' || kind === 'wireless' || kind === 'cellular' || media === 'PON'
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
