import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Partner / unit grants and site shares (P1-07c, ADR-029/031).

export type GrantMember = components['schemas']['GrantMember']
export type PartnerGrantRole = components['schemas']['PartnerGrantRole']
export type UnitGrantRole = components['schemas']['UnitGrantRole']
export type SiteShare = components['schemas']['SiteShare']
export type ShareAccess = components['schemas']['ShareAccess']
export type ShareTargetType = components['schemas']['ShareTargetType']

export const PARTNER_GRANT_ROLES: PartnerGrantRole[] = ['partner_admin', 'editor', 'viewer']
export const UNIT_GRANT_ROLES: UnitGrantRole[] = ['unit_admin', 'editor', 'viewer']

/** Which grant list: a partner's or a unit's. */
export type GrantScope = { kind: 'partner'; id: string } | { kind: 'unit'; id: string }

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const grantKey = (orgId: string, scope: GrantScope) => [
  'orgs',
  orgId,
  'grants',
  scope.kind,
  scope.id,
]

export function useGrants(orgId: string, scope: GrantScope, enabled = true) {
  return useQuery({
    queryKey: grantKey(orgId, scope),
    enabled,
    queryFn: async () => {
      const r =
        scope.kind === 'partner'
          ? await api.GET('/orgs/{orgId}/partners/{partnerId}/members', {
              params: { path: { orgId, partnerId: scope.id } },
            })
          : await api.GET('/orgs/{orgId}/business-units/{businessUnitId}/members', {
              params: { path: { orgId, businessUnitId: scope.id } },
            })
      if (r.data) return r.data.members
      fail(r.error, r.response.status, i18n.t('grants.loadError'))
    },
  })
}

export function useGrantMutations(orgId: string, scope: GrantScope) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: grantKey(orgId, scope) })
  const add = useMutation({
    mutationFn: async (body: { email: string; role: string }) => {
      const r =
        scope.kind === 'partner'
          ? await api.POST('/orgs/{orgId}/partners/{partnerId}/members', {
              params: { ...csrfParam, path: { orgId, partnerId: scope.id } },
              body: { email: body.email, role: body.role as PartnerGrantRole },
            })
          : await api.POST('/orgs/{orgId}/business-units/{businessUnitId}/members', {
              params: { ...csrfParam, path: { orgId, businessUnitId: scope.id } },
              body: { email: body.email, role: body.role as UnitGrantRole },
            })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const update = useMutation({
    mutationFn: async ({ member, role }: { member: GrantMember; role: string }) => {
      const r =
        scope.kind === 'partner'
          ? await api.PATCH('/orgs/{orgId}/partners/{partnerId}/members/{userId}', {
              params: { ...csrfParam, path: { orgId, partnerId: scope.id, userId: member.userId } },
              body: { role: role as PartnerGrantRole, version: member.version },
            })
          : await api.PATCH('/orgs/{orgId}/business-units/{businessUnitId}/members/{userId}', {
              params: {
                ...csrfParam,
                path: { orgId, businessUnitId: scope.id, userId: member.userId },
              },
              body: { role: role as UnitGrantRole, version: member.version },
            })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (member: GrantMember) => {
      const r =
        scope.kind === 'partner'
          ? await api.DELETE('/orgs/{orgId}/partners/{partnerId}/members/{userId}', {
              params: { ...csrfParam, path: { orgId, partnerId: scope.id, userId: member.userId } },
            })
          : await api.DELETE('/orgs/{orgId}/business-units/{businessUnitId}/members/{userId}', {
              params: {
                ...csrfParam,
                path: { orgId, businessUnitId: scope.id, userId: member.userId },
              },
            })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { add, update, remove }
}

const shareKey = (orgId: string, siteId: string) => ['orgs', orgId, 'sites', siteId, 'shares']

export function useSiteShares(orgId: string, siteId: string, enabled = true) {
  return useQuery({
    queryKey: shareKey(orgId, siteId),
    enabled,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/sites/{siteId}/shares', {
        params: { path: { orgId, siteId } },
      })
      if (r.data) return r.data.shares
      fail(r.error, r.response.status, i18n.t('shares.loadError'))
    },
  })
}

export function useShareMutations(orgId: string, siteId: string) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: shareKey(orgId, siteId) })
  const path = { orgId, siteId }
  const create = useMutation({
    mutationFn: async (body: {
      targetType: ShareTargetType
      targetId: string
      access: ShareAccess
    }) => {
      const r = await api.POST('/orgs/{orgId}/sites/{siteId}/shares', {
        params: { ...csrfParam, path },
        body,
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const update = useMutation({
    mutationFn: async ({ share, access }: { share: SiteShare; access: ShareAccess }) => {
      const r = await api.PATCH('/orgs/{orgId}/sites/{siteId}/shares/{shareId}', {
        params: { ...csrfParam, path: { ...path, shareId: share.id } },
        body: { access, version: share.version },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (share: SiteShare) => {
      const r = await api.DELETE('/orgs/{orgId}/sites/{siteId}/shares/{shareId}', {
        params: { ...csrfParam, path: { ...path, shareId: share.id } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { create, update, remove }
}
