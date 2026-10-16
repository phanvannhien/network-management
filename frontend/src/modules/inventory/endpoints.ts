import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Endpoint groups (P1-11, SRS §4.4): many similar end devices kept as one item, members promotable to devices.

export type EndpointGroup = components['schemas']['EndpointGroup']
export type EndpointGroupDetail = components['schemas']['EndpointGroupDetail']
export type EndpointGroupInput = components['schemas']['EndpointGroupInput']
export type EndpointKind = components['schemas']['EndpointKind']
export type EndpointMember = components['schemas']['EndpointMember']
export type EndpointMemberInput = components['schemas']['EndpointMemberInput']

export const ENDPOINT_KINDS: EndpointKind[] = [
  'ip_camera',
  'pc',
  'laptop',
  'printer',
  'ip_phone',
  'access_point',
  'access_control',
  'video_conference',
  'iot',
  'server',
  'vm',
  'nas',
  'other',
]

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'endpoint-groups'] as const,
  one: (orgId: string, id: string) => ['orgs', orgId, 'endpoint-groups', id] as const,
}

export function useEndpointGroups(orgId: string, enabled = true) {
  return useQuery({
    queryKey: keys.all(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/endpoint-groups', { params: { path: { orgId } } })
      if (r.data) return r.data.groups
      fail(r.error, r.response.status, i18n.t('errors.endpointsLoad'))
    },
  })
}

export function useEndpointGroup(orgId: string, groupId: string) {
  return useQuery({
    queryKey: keys.one(orgId, groupId),
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/endpoint-groups/{groupId}', {
        params: { path: { orgId, groupId } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.endpointsLoad'))
    },
  })
}

/** Group / member writes change IPAM usage and (promote) the device list: refresh those too. */
export function useEndpointMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.all(orgId) }),
      qc.invalidateQueries({ queryKey: ['orgs', orgId, 'ipam'] }),
      qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] }),
      qc.invalidateQueries({ queryKey: ['orgs', orgId, 'links'] }),
    ])
  const saveGroup = useMutation({
    mutationFn: async (input: { group?: EndpointGroup; body: EndpointGroupInput }) => {
      const r = input.group
        ? await api.PATCH('/orgs/{orgId}/endpoint-groups/{groupId}', {
            params: { ...csrfParam, path: { orgId, groupId: input.group.id } },
            body: { ...input.body, version: input.group.version },
          })
        : await api.POST('/orgs/{orgId}/endpoint-groups', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const removeGroup = useMutation({
    mutationFn: async (groupId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/endpoint-groups/{groupId}', {
        params: { ...csrfParam, path: { orgId, groupId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  const saveMember = useMutation({
    mutationFn: async (input: {
      groupId: string
      member?: EndpointMember
      body: EndpointMemberInput
    }) => {
      const r = input.member
        ? await api.PATCH('/orgs/{orgId}/endpoint-groups/{groupId}/members/{memberId}', {
            params: {
              ...csrfParam,
              path: { orgId, groupId: input.groupId, memberId: input.member.id },
            },
            body: { ...input.body, version: input.member.version },
          })
        : await api.POST('/orgs/{orgId}/endpoint-groups/{groupId}/members', {
            params: { ...csrfParam, path: { orgId, groupId: input.groupId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const removeMember = useMutation({
    mutationFn: async (input: { groupId: string; memberId: string }) => {
      const r = await api.DELETE('/orgs/{orgId}/endpoint-groups/{groupId}/members/{memberId}', {
        params: { ...csrfParam, path: { orgId, ...input } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  const promote = useMutation({
    mutationFn: async (input: { groupId: string; memberId: string; hostname: string }) => {
      const r = await api.POST(
        '/orgs/{orgId}/endpoint-groups/{groupId}/members/{memberId}/promote',
        {
          params: {
            ...csrfParam,
            path: { orgId, groupId: input.groupId, memberId: input.memberId },
          },
          body: { hostname: input.hostname },
        },
      )
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { saveGroup, removeGroup, saveMember, removeMember, promote }
}
