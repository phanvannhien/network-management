import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Expiry alerts (P2-05, ADR-043): the installation's mail server (system admins), the organization's alert
// settings (owners / admins), the bell, muting one device.

export type SmtpSettings = components['schemas']['SmtpSettings']
export type SmtpSettingsInput = components['schemas']['SmtpSettingsInput']
export type AlertSettings = components['schemas']['AlertSettings']
export type AlertSettingsInput = components['schemas']['AlertSettingsInput']
export type AlertKind = components['schemas']['AlertKind']
export type Notification = components['schemas']['Notification']

export const ALERT_KINDS: AlertKind[] = ['warranty', 'license', 'eos']

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  smtp: ['admin', 'smtp'] as const,
  settings: (orgId: string) => ['orgs', orgId, 'alert-settings'] as const,
  bell: (orgId: string) => ['orgs', orgId, 'notifications'] as const,
}

export function useSmtp(enabled = true) {
  return useQuery({
    queryKey: keys.smtp,
    enabled,
    queryFn: async () => {
      const r = await api.GET('/admin/smtp')
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('smtp.loadFailed'))
    },
  })
}

export function useSaveSmtp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SmtpSettingsInput) => {
      const r = await api.PUT('/admin/smtp', { params: csrfParam, body })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSuccess: (data) => qc.setQueryData(keys.smtp, data),
  })
}

export function useTestSmtp() {
  return useMutation({
    mutationFn: async (to: string) => {
      const r = await api.POST('/admin/smtp/test', { params: csrfParam, body: { to } })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('smtp.testFailed'))
    },
  })
}

export function useAlertSettings(orgId: string, enabled = true) {
  return useQuery({
    queryKey: keys.settings(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/alert-settings', { params: { path: { orgId } } })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('alerts.loadFailed'))
    },
  })
}

export function useSaveAlertSettings(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: AlertSettingsInput) => {
      const r = await api.PUT('/orgs/{orgId}/alert-settings', {
        params: { ...csrfParam, path: { orgId } },
        body,
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSuccess: (data) => qc.setQueryData(keys.settings(orgId), data),
  })
}

/** The bell: refreshed every few minutes and when the window comes back. */
export function useNotifications(orgId: string) {
  return useQuery({
    queryKey: keys.bell(orgId),
    enabled: orgId !== '',
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/notifications', { params: { path: { orgId } } })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('notifications.loadFailed'))
    },
  })
}

export function useMarkNotificationsSeen(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await api.POST('/orgs/{orgId}/notifications/seen', {
        params: { ...csrfParam, path: { orgId } },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.bell(orgId) }),
  })
}

export function useMuteAlerts(orgId: string, deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (muted: boolean) => {
      const r = await api.PUT('/orgs/{orgId}/devices/{deviceId}/alerts-muted', {
        params: { ...csrfParam, path: { orgId, deviceId } },
        body: { muted },
      })
      if (!r.response.ok) fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] }),
  })
}
