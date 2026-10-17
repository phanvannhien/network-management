import { useQuery } from '@tanstack/react-query'
import { api, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

export type Dashboard = components['schemas']['Dashboard']
export type DashboardProblem = components['schemas']['DashboardProblem']

/** Dashboard figures (P1-24) for the organization, narrowed to the topbar category. */
export function useDashboard(orgId: string, categoryId: string | null) {
  return useQuery({
    queryKey: ['orgs', orgId, 'dashboard', categoryId],
    enabled: orgId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/dashboard', {
        params: { path: { orgId }, query: categoryId ? { categoryId } : {} },
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('errors.dashboardLoad')))
    },
  })
}
