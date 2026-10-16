import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type OrganizationKind } from '../api/client'
import i18n from '@/i18n'

export const orgKeys = {
  mine: ['orgs', 'mine'] as const,
  detail: (orgId: string) => ['orgs', orgId] as const,
  admin: ['admin', 'organizations'] as const,
}

/** Thrown for 404 so pages can tell "no access / not found" apart from other failures. */
export class NotFoundError extends Error {}

export function useMyOrganizations() {
  return useQuery({
    queryKey: orgKeys.mine,
    queryFn: async () => {
      const result = await api.GET('/orgs')
      if (result.data) return result.data.organizations
      throw new Error(errorMessage(result.error, result.response.status, i18n.t('errors.orgsLoad')))
    },
  })
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: orgKeys.detail(orgId),
    enabled: orgId !== '',
    retry: false,
    queryFn: async () => {
      const result = await api.GET('/orgs/{orgId}', { params: { path: { orgId } } })
      if (result.data) return result.data
      if (result.response.status === 404) throw new NotFoundError(i18n.t('errors.orgNotFound'))
      throw new Error(errorMessage(result.error, result.response.status, i18n.t('errors.orgLoad')))
    },
  })
}

export class ConflictError extends Error {}

export function useUpdateOrganization(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      name: string
      code: string
      notes: string
      version: number
      confirmSiteCodes?: boolean
    }) => {
      const result = await api.PATCH('/orgs/{orgId}', {
        params: { ...csrfParam, path: { orgId } },
        body,
      })
      if (result.data) return result.data
      const message = errorMessage(result.error, result.response.status, i18n.t('errors.save'))
      throw result.response.status === 409 ? new ConflictError(message) : new Error(message)
    },
    onSuccess: (view) => {
      queryClient.setQueryData(orgKeys.detail(orgId), view)
      void queryClient.invalidateQueries({ queryKey: orgKeys.mine })
    },
  })
}

/** Remember the organization as the default after sign-in (fire-and-forget). */
export function activateOrganization(orgId: string): void {
  void api.POST('/orgs/{orgId}/activate', { params: { ...csrfParam, path: { orgId } } })
}

export function useAdminOrganizations() {
  return useQuery({
    queryKey: orgKeys.admin,
    queryFn: async () => {
      const result = await api.GET('/admin/organizations')
      if (result.data) return result.data.organizations
      throw new Error(errorMessage(result.error, result.response.status, i18n.t('errors.orgsLoad')))
    },
  })
}

export function useAdminCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      name: string
      kind: OrganizationKind
      notes: string
      addMeAsOwner: boolean
    }) => {
      const result = await api.POST('/admin/organizations', { params: csrfParam, body })
      if (result.data) return result.data
      throw new Error(
        errorMessage(result.error, result.response.status, i18n.t('errors.orgCreate')),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.admin })
      void queryClient.invalidateQueries({ queryKey: orgKeys.mine })
    },
  })
}

export function useAdminDeleteOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orgId: string) => {
      const result = await api.DELETE('/admin/organizations/{orgId}', {
        params: { ...csrfParam, path: { orgId } },
      })
      if (result.response.status === 204) return
      throw new Error(
        errorMessage(result.error, result.response.status, i18n.t('errors.orgDelete')),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.admin })
      void queryClient.invalidateQueries({ queryKey: orgKeys.mine })
    },
  })
}
