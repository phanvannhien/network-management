import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import { useOrganization } from '@/app/orgs'
import i18n from '@/i18n'

// Password vault (P2-02 device credentials, P2-03 cloud accounts; ADR-045). Lists never carry a secret; a secret
// comes only from reveal(), which may answer "confirm MFA first" (428).

export type Credential = components['schemas']['Credential']
export type CredentialKind = components['schemas']['CredentialKind']
export type CredentialInput = components['schemas']['CredentialInput']
export type CredentialDetail = components['schemas']['CredentialDetail']
export type CloudAccount = components['schemas']['CloudAccount']
export type CloudProvider = components['schemas']['CloudProvider']
export type CloudAccountInput = components['schemas']['CloudAccountInput']
export type CloudAccountDetail = components['schemas']['CloudAccountDetail']

export const CREDENTIAL_KINDS: CredentialKind[] = [
  'ssh',
  'web',
  'console',
  'enable',
  'telnet',
  'snmp',
  'api',
  'other',
]
export const CLOUD_PROVIDERS: CloudProvider[] = [
  'forticloud',
  'meraki',
  'unifi',
  'omada',
  'aruba_central',
  'hik_connect',
  'other',
]

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

/** The server wants a fresh MFA code before showing a secret (HTTP 428). */
export class MfaNeeded extends Error {}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'vault'] as const,
  creds: (orgId: string, q: string, deviceId: string) =>
    ['orgs', orgId, 'vault', 'creds', q, deviceId] as const,
  cred: (orgId: string, id: string) => ['orgs', orgId, 'vault', 'cred', id] as const,
  clouds: (orgId: string, q: string, deviceId: string) =>
    ['orgs', orgId, 'vault', 'clouds', q, deviceId] as const,
  cloud: (orgId: string, id: string) => ['orgs', orgId, 'vault', 'cloud', id] as const,
}

/** What the user may do here: write entries (credential.manage) and see secrets (credential.reveal). */
export function useVaultRights(orgId: string) {
  const org = useOrganization(orgId)
  const m = org.data?.membership
  const admin = m?.role === 'owner' || m?.role === 'admin'
  return {
    canManage: admin || (m?.permissions.includes('credential.manage') ?? false),
    canReveal: admin || (m?.permissions.includes('credential.reveal') ?? false),
  }
}

function useInvalidate(orgId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: keys.all(orgId) })
    void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'notifications'] })
  }
}

export function useCredentials(orgId: string, q = '', deviceId = '', enabled = true) {
  return useQuery({
    queryKey: keys.creds(orgId, q, deviceId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/credentials', {
        params: {
          path: { orgId },
          query: { q: q.trim() || undefined, deviceId: deviceId || undefined },
        },
      })
      if (r.data) return r.data.credentials
      fail(r.error, r.response.status, i18n.t('vault.loadFailed'))
    },
  })
}

export function useCredential(orgId: string, id: string) {
  return useQuery({
    queryKey: keys.cred(orgId, id),
    enabled: orgId !== '' && id !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/credentials/{credentialId}', {
        params: { path: { orgId, credentialId: id } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('vault.loadFailed'))
    },
  })
}

export function useCredentialMutations(orgId: string) {
  const invalidate = useInvalidate(orgId)
  const save = useMutation({
    mutationFn: async (v: { id?: string; body: CredentialInput }) => {
      const r = v.id
        ? await api.PATCH('/orgs/{orgId}/credentials/{credentialId}', {
            params: { ...csrfParam, path: { orgId, credentialId: v.id } },
            body: v.body,
          })
        : await api.POST('/orgs/{orgId}/credentials', {
            params: { ...csrfParam, path: { orgId } },
            body: v.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.DELETE('/orgs/{orgId}/credentials/{credentialId}', {
        params: { ...csrfParam, path: { orgId, credentialId: id } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  return { save, remove }
}

export function useCloudAccounts(orgId: string, q = '', deviceId = '', enabled = true) {
  return useQuery({
    queryKey: keys.clouds(orgId, q, deviceId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/cloud-accounts', {
        params: {
          path: { orgId },
          query: { q: q.trim() || undefined, deviceId: deviceId || undefined },
        },
      })
      if (r.data) return r.data.accounts
      fail(r.error, r.response.status, i18n.t('vault.loadFailed'))
    },
  })
}

export function useCloudAccount(orgId: string, id: string) {
  return useQuery({
    queryKey: keys.cloud(orgId, id),
    enabled: orgId !== '' && id !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/cloud-accounts/{accountId}', {
        params: { path: { orgId, accountId: id } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('vault.loadFailed'))
    },
  })
}

export function useCloudMutations(orgId: string) {
  const invalidate = useInvalidate(orgId)
  const save = useMutation({
    mutationFn: async (v: { id?: string; body: CloudAccountInput }) => {
      const r = v.id
        ? await api.PATCH('/orgs/{orgId}/cloud-accounts/{accountId}', {
            params: { ...csrfParam, path: { orgId, accountId: v.id } },
            body: v.body,
          })
        : await api.POST('/orgs/{orgId}/cloud-accounts', {
            params: { ...csrfParam, path: { orgId } },
            body: v.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.DELETE('/orgs/{orgId}/cloud-accounts/{accountId}', {
        params: { ...csrfParam, path: { orgId, accountId: id } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.delete'))
    },
    onSettled: invalidate,
  })
  return { save, remove }
}

/** Fetch a secret to show or copy (audited by the server). Throws MfaNeeded on 428. */
export async function revealSecret(
  orgId: string,
  what: { credentialId: string } | { accountId: string },
  action: 'reveal' | 'copy',
): Promise<{ secret: string; clearAfterSeconds: number }> {
  const r =
    'credentialId' in what
      ? await api.POST('/orgs/{orgId}/credentials/{credentialId}/reveal', {
          params: { ...csrfParam, path: { orgId, credentialId: what.credentialId } },
          body: { action },
        })
      : await api.POST('/orgs/{orgId}/cloud-accounts/{accountId}/reveal', {
          params: { ...csrfParam, path: { orgId, accountId: what.accountId } },
          body: { action },
        })
  if (r.data) return r.data
  if (r.response.status === 428)
    throw new MfaNeeded(errorMessage(r.error, 428, i18n.t('vault.mfaNeeded')))
  return fail(r.error, r.response.status, i18n.t('vault.revealFailed'))
}
