import { useQuery } from '@tanstack/react-query'
import { api, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Reports (P2-11): read-only listings from the server, scoped by the topbar category and / or one site.

export type IpPlanRow = components['schemas']['IpPlanRow']
export type VlanReportRow = components['schemas']['VlanReportRow']
export type PortMapDevice = components['schemas']['PortMapDevice']
export type BoqLine = components['schemas']['BoqLine']

export type ReportKind = 'ip-plan' | 'vlans' | 'port-map' | 'boq'

export interface ReportScope {
  categoryId: string | null
  siteId: string
}

const query = (s: ReportScope) => ({
  ...(s.categoryId ? { categoryId: s.categoryId } : {}),
  ...(s.siteId ? { siteId: s.siteId } : {}),
})

function useReport<T>(
  orgId: string,
  kind: ReportKind,
  scope: ReportScope,
  enabled: boolean,
  load: () => Promise<T>,
) {
  return useQuery({
    queryKey: ['orgs', orgId, 'reports', kind, scope.categoryId, scope.siteId],
    enabled: enabled && orgId !== '',
    staleTime: 30_000,
    queryFn: load,
  })
}

function fail(error: unknown, status: number): never {
  throw new Error(errorMessage(error, status, i18n.t('reports.loadFailed')))
}

export function useIpPlanReport(orgId: string, scope: ReportScope, enabled = true) {
  return useReport(orgId, 'ip-plan', scope, enabled, async () => {
    const r = await api.GET('/orgs/{orgId}/reports/ip-plan', {
      params: { path: { orgId }, query: query(scope) },
    })
    if (r.data) return r.data.subnets
    fail(r.error, r.response.status)
  })
}

export function useVlanReport(orgId: string, scope: ReportScope, enabled = true) {
  return useReport(orgId, 'vlans', scope, enabled, async () => {
    const r = await api.GET('/orgs/{orgId}/reports/vlans', {
      params: { path: { orgId }, query: query(scope) },
    })
    if (r.data) return r.data.vlans
    fail(r.error, r.response.status)
  })
}

export function usePortMapReport(orgId: string, scope: ReportScope, enabled = true) {
  return useReport(orgId, 'port-map', scope, enabled, async () => {
    const r = await api.GET('/orgs/{orgId}/reports/port-map', {
      params: { path: { orgId }, query: query(scope) },
    })
    if (r.data) return r.data.devices
    fail(r.error, r.response.status)
  })
}

export function useBoqReport(orgId: string, scope: ReportScope, enabled = true) {
  return useReport(orgId, 'boq', scope, enabled, async () => {
    const r = await api.GET('/orgs/{orgId}/reports/boq', {
      params: { path: { orgId }, query: query(scope) },
    })
    if (r.data) return r.data.lines
    fail(r.error, r.response.status)
  })
}
