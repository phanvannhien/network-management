import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'
import { MfaNeeded } from '@/modules/vault/vault'

// Backups of the installation (P2-13, ADR-053): status, destinations, run now, download. System admins only.

export type BackupStatus = components['schemas']['BackupStatus']
export type BackupTarget = components['schemas']['BackupTarget']
export type BackupTargetInput = components['schemas']['BackupTargetInput']
export type BackupTargetKind = components['schemas']['BackupTargetKind']
export type BackupFile = components['schemas']['BackupFile']

const KEY = ['admin', 'backups'] as const

export function useBackups(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: KEY,
    enabled,
    refetchInterval: poll ? 5_000 : 60_000,
    queryFn: async () => {
      const r = await api.GET('/admin/backups')
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('backups.loadFailed')))
    },
  })
}

export function useSaveTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: BackupTargetInput }) => {
      const r = id
        ? await api.PUT('/admin/backup-targets/{targetId}', {
            params: { path: { targetId: id }, ...csrfParam },
            body,
          })
        : await api.POST('/admin/backup-targets', { params: csrfParam, body })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('backups.saveFailed')))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await api.DELETE('/admin/backup-targets/{targetId}', {
        params: { path: { targetId: id }, ...csrfParam },
      })
      if (r.response.ok) return
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('backups.deleteFailed')))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useTestTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await api.POST('/admin/backup-targets/{targetId}/test', {
        params: { path: { targetId: id }, ...csrfParam },
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('backups.testFailed')))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useRunBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await api.POST('/admin/backups/run', { params: csrfParam })
      if (r.response.ok) return
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('backups.runFailed')))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Downloads a backup file (still encrypted). Throws MfaNeeded when a fresh MFA code is required. */
export async function downloadBackup(name: string) {
  const res = await fetch(`/api/admin/backups/files/${encodeURIComponent(name)}`, {
    credentials: 'same-origin',
  })
  if (res.status === 428) throw new MfaNeeded(i18n.t('backups.mfaNeeded'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || i18n.t('backups.downloadFailed'))
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const sizeText = (n: number) =>
  n >= 1 << 30
    ? `${(n / (1 << 30)).toFixed(1)} GiB`
    : n >= 1 << 20
      ? `${(n / (1 << 20)).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(n / 1024))} KiB`
