import { create } from 'zustand'
import type { components } from '@/api/client'
import { useOrganization } from '@/app/orgs'

export type AccessLevel = components['schemas']['AccessLevel']

const RANK: Record<AccessLevel, number> = { view: 1, edit: 2, admin: 3 }

/** The caller's access on a partner / unit / site (from the API) is at least `need`. */
export function atLeast(level: AccessLevel | undefined, need: AccessLevel): boolean {
  return level !== undefined && RANK[level] >= RANK[need]
}

/**
 * What the caller may do in the organization (ADR-031), for showing or hiding actions only — the server
 * checks every request. Organization owner/admin/editor/viewer act organization-wide; role "member" acts
 * through partner / unit grants.
 */
export function useOrgAccess(orgId: string) {
  const ms = useOrganization(orgId).data?.membership
  const role = ms?.role
  const orgAdmin = role === 'owner' || role === 'admin'
  const orgEdit = orgAdmin || role === 'editor'
  const partnerGrants = ms?.partnerGrants ?? []
  const unitGrants = ms?.unitGrants ?? []
  const partnerAdminOf = (partnerId: string) =>
    orgAdmin || partnerGrants.some((g) => g.partnerId === partnerId && g.role === 'partner_admin')
  return {
    ready: ms !== undefined,
    restricted: role === 'member',
    orgAdmin,
    orgEdit,
    partnerAdminOf,
    /** May add units to at least one partner. */
    canAddUnits: orgAdmin || partnerGrants.some((g) => g.role === 'partner_admin'),
    /** May add sites somewhere. */
    canAddSites:
      orgEdit ||
      partnerGrants.some((g) => g.role !== 'viewer') ||
      unitGrants.some((g) => g.role !== 'viewer'),
  }
}

/**
 * Topbar partner / unit selector (ADR-031): a display filter only, remembered per organization in this
 * browser. Access is always decided by the server.
 */
export interface Scope {
  partnerId: string | null
  unitId: string | null
}

const STORAGE = 'ntb-scope'

function readAll(): Record<string, Scope> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Record<string, Scope>
  } catch {
    return {}
  }
}

export const useScopeStore = create<{
  scopes: Record<string, Scope>
  set: (orgId: string, scope: Scope) => void
}>((set) => ({
  scopes: readAll(),
  set: (orgId, scope) =>
    set((s) => {
      const scopes = { ...s.scopes, [orgId]: scope }
      localStorage.setItem(STORAGE, JSON.stringify(scopes))
      return { scopes }
    }),
}))

const ALL: Scope = { partnerId: null, unitId: null }

export function useScope(orgId: string): Scope {
  return useScopeStore((s) => s.scopes[orgId] ?? ALL)
}

/** Whether a partner / unit / site row passes the topbar filter (shared sites pass only "all"). */
export function inScope(
  scope: Scope,
  row: { partnerId?: string | null; unitId?: string | null },
): boolean {
  if (scope.unitId) return row.unitId === scope.unitId
  if (scope.partnerId) return row.partnerId === scope.partnerId
  return true
}
