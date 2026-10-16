import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '../../api/client'

export type Member = components['schemas']['Member']
export type Permission = components['schemas']['Permission']
export type AdminUser = components['schemas']['AdminUser']
type Role = components['schemas']['Role']

/** i18n keys for permission labels (API names contain dots, which i18next treats as nesting). */
export const PERMISSION_KEYS = {
  'credential.reveal': 'permissions.credentialReveal',
  'credential.manage': 'permissions.credentialManage',
  'user.manage': 'permissions.userManage',
} as const satisfies Record<Permission, string>

export const ALL_PERMISSIONS = Object.keys(PERMISSION_KEYS) as Permission[]

export const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer']

/** Link the inviter sends out of band (no SMTP until P2-05). */
export function accountLink(token: string): string {
  return `${window.location.origin}/invite/${token}`
}

const membersKey = (orgId: string) => ['orgs', orgId, 'members'] as const

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: membersKey(orgId),
    enabled: orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/members', { params: { path: { orgId } } })
      if (r.data) return r.data.members
      throw new Error(errorMessage(r.error, r.response.status, 'Không tải được thành viên'))
    },
  })
}

function useMemberMutation<TInput, TResult>(
  orgId: string,
  fn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: membersKey(orgId) }),
  })
}

export function useAddMember(orgId: string) {
  return useMemberMutation(
    orgId,
    async (body: { email: string; role: Role; permissions: Permission[] }) => {
      const r = await api.POST('/orgs/{orgId}/members', {
        params: { ...csrfParam, path: { orgId } },
        body,
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, 'Không thêm được thành viên'))
    },
  )
}

export function useUpdateMember(orgId: string) {
  return useMemberMutation(
    orgId,
    async (input: { userId: string; role: Role; permissions: Permission[]; version: number }) => {
      const { userId, ...body } = input
      const r = await api.PATCH('/orgs/{orgId}/members/{userId}', {
        params: { ...csrfParam, path: { orgId, userId } },
        body,
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, 'Không lưu được'))
    },
  )
}

export function useRemoveMember(orgId: string) {
  return useMemberMutation(orgId, async (userId: string) => {
    const r = await api.DELETE('/orgs/{orgId}/members/{userId}', {
      params: { ...csrfParam, path: { orgId, userId } },
    })
    if (r.response.status === 204) return
    throw new Error(errorMessage(r.error, r.response.status, 'Không gỡ được thành viên'))
  })
}

export function useRegenerateInvite(orgId: string) {
  return useMemberMutation(orgId, async (userId: string) => {
    const r = await api.POST('/orgs/{orgId}/members/{userId}/invite', {
      params: { ...csrfParam, path: { orgId, userId } },
    })
    if (r.data) return r.data.inviteToken
    throw new Error(errorMessage(r.error, r.response.status, 'Không tạo được link mời'))
  })
}

const adminUsersKey = ['admin', 'users'] as const

export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: adminUsersKey,
    enabled,
    queryFn: async () => {
      const r = await api.GET('/admin/users')
      if (r.data) return r.data.users
      throw new Error(errorMessage(r.error, r.response.status, 'Không tải được người dùng'))
    },
  })
}

type AdminAction = 'disable' | 'enable' | 'reset-mfa'

export function useAdminUserAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: AdminAction }) => {
      const params = { ...csrfParam, path: { userId } }
      const r =
        action === 'disable'
          ? await api.POST('/admin/users/{userId}/disable', { params })
          : action === 'enable'
            ? await api.POST('/admin/users/{userId}/enable', { params })
            : await api.POST('/admin/users/{userId}/reset-mfa', { params })
      if (r.response.status === 204) return
      throw new Error(errorMessage(r.error, r.response.status, 'Thao tác thất bại'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminUsersKey }),
  })
}

export function useAdminPasswordReset() {
  return useMutation({
    mutationFn: async (userId: string) => {
      const r = await api.POST('/admin/users/{userId}/password-reset', {
        params: { ...csrfParam, path: { userId } },
      })
      if (r.data) return r.data.resetToken
      throw new Error(
        errorMessage(r.error, r.response.status, 'Không tạo được link đặt lại mật khẩu'),
      )
    },
  })
}
