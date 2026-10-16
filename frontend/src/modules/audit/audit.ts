import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

export type AuditEntry = components['schemas']['AuditEntry']

export interface AuditQuery {
  page: number
  pageSize: number
  q: string
  categories: string[]
  actorId?: string
  from?: string
}

/** Organization audit (orgId) or the system-level audit (orgId undefined, system admins). */
export function useAuditLog(orgId: string | undefined, query: AuditQuery) {
  return useQuery({
    queryKey: orgId ? ['orgs', orgId, 'audit', query] : ['admin', 'audit', query],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = {
        page: query.page,
        pageSize: query.pageSize,
        q: query.q || undefined,
        category: query.categories.length ? query.categories : undefined,
        actorId: query.actorId,
        from: query.from,
      }
      const r = orgId
        ? await api.GET('/orgs/{orgId}/audit', { params: { path: { orgId }, query: params } })
        : await api.GET('/admin/audit', { params: { query: params } })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('errors.auditLoad')))
    },
  })
}

/** i18n key for an action ("member.update" → "audit.actions.member_update"). */
export function actionKey(action: string) {
  return `audit.actions.${action.replace(/\./g, '_')}`
}

export const PERIOD_HOURS = { day: 24, week: 24 * 7, month: 24 * 30, year: 24 * 365 } as const
export type Period = keyof typeof PERIOD_HOURS
