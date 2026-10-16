import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Device inventory (P1-08, SRS §4.1): server-side list + CRUD, bulk edit, history; custom field definitions.

export type Device = components['schemas']['Device']
export type DeviceInput = components['schemas']['DeviceInput']
export type DeviceType = components['schemas']['DeviceType']
export type DeviceRole = components['schemas']['DeviceRole']
export type DeviceLifecycle = components['schemas']['DeviceLifecycle']
export type DeviceBulkUpdate = components['schemas']['DeviceBulkUpdate']
export type CustomField = components['schemas']['CustomField']
export type CustomFieldKind = components['schemas']['CustomFieldKind']
export type HistoryEntry = components['schemas']['DeviceHistory']['entries'][number]

/** Grouped like the template library (SRS §4.3) for selects and filters. */
export const DEVICE_TYPE_GROUPS: { group: string; types: DeviceType[] }[] = [
  {
    group: 'routing',
    types: ['router', 'l3_switch', 'load_balancer', 'wireless_controller', 'sdwan_edge'],
  },
  {
    group: 'switching',
    types: ['l2_switch', 'poe_switch', 'access_point', 'media_converter', 'patch_panel'],
  },
  { group: 'security', types: ['firewall', 'ids_ips', 'vpn_gateway', 'waf', 'nac', 'proxy'] },
  {
    group: 'endpoints',
    types: [
      'server',
      'vm',
      'nas',
      'pc',
      'laptop',
      'printer',
      'ip_camera',
      'nvr',
      'ip_phone',
      'pbx',
      'access_control',
      'video_conference',
      'iot',
    ],
  },
  { group: 'wan', types: ['modem', 'ont'] },
  { group: 'other', types: ['ups', 'pdu', 'other'] },
]
export const DEVICE_TYPES: DeviceType[] = DEVICE_TYPE_GROUPS.flatMap((g) => g.types)
export const DEVICE_ROLES: DeviceRole[] = [
  'none',
  'core',
  'distribution',
  'access',
  'edge',
  'dmz',
  'oob',
]
export const LIFECYCLES: DeviceLifecycle[] = ['planned', 'active', 'spare', 'rma', 'retired']

export type DeviceSort =
  | 'hostname'
  | 'type'
  | 'vendor'
  | 'model'
  | 'serial'
  | 'site'
  | 'unit'
  | 'lifecycle'
  | 'warrantyEnd'

export interface ListParams {
  q: string
  /** FilterBar facets: site, type, vendor, lifecycle, role, tag. */
  facets: Record<string, string[]>
  partnerId: string | null
  unitId: string | null
  sort: { id: DeviceSort; desc: boolean } | null
  pageIndex: number
  pageSize: number
}

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'devices'] as const,
  list: (orgId: string, p: ListParams) => ['orgs', orgId, 'devices', 'list', p] as const,
  one: (orgId: string, id: string) => ['orgs', orgId, 'devices', 'detail', id] as const,
  history: (orgId: string, id: string) => ['orgs', orgId, 'devices', 'history', id] as const,
  fields: (orgId: string) => ['orgs', orgId, 'custom-fields'] as const,
}

export function useDeviceList(orgId: string, p: ListParams, enabled = true) {
  return useQuery({
    queryKey: keys.list(orgId, p),
    enabled: enabled && orgId !== '',
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const f = p.facets
      const r = await api.GET('/orgs/{orgId}/devices', {
        params: {
          path: { orgId },
          query: {
            q: p.q.trim() || undefined,
            partnerId: p.partnerId ?? undefined,
            businessUnitId: p.unitId ?? undefined,
            siteId: f.site?.length ? f.site : undefined,
            type: f.type?.length ? (f.type as DeviceType[]) : undefined,
            vendor: f.vendor?.length ? f.vendor : undefined,
            lifecycle: f.lifecycle?.length ? (f.lifecycle as DeviceLifecycle[]) : undefined,
            role: f.role?.length ? (f.role as DeviceRole[]) : undefined,
            tag: f.tag?.length ? f.tag : undefined,
            sort: p.sort?.id,
            desc: p.sort?.desc || undefined,
            page: p.pageIndex + 1,
            pageSize: p.pageSize,
          },
        },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
    },
  })
}

export function useDevice(orgId: string, deviceId: string) {
  return useQuery({
    queryKey: keys.one(orgId, deviceId),
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/devices/{deviceId}', {
        params: { path: { orgId, deviceId } },
      })
      if (r.data) return r.data
      if (r.response.status === 404) return null
      fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
    },
  })
}

export function useDeviceHistory(orgId: string, deviceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.history(orgId, deviceId),
    enabled,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/devices/{deviceId}/history', {
        params: { path: { orgId, deviceId } },
      })
      if (r.data) return r.data.entries
      fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
    },
  })
}

/** Device writes change lists, details, counts on sites and the history: refresh everything of devices. */
function useInvalidateDevices(orgId: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: keys.all(orgId) })
}

export function useSaveDevice(orgId: string) {
  const invalidate = useInvalidateDevices(orgId)
  return useMutation({
    mutationFn: async (input: { device?: Device; body: DeviceInput }) => {
      const r = input.device
        ? await api.PATCH('/orgs/{orgId}/devices/{deviceId}', {
            params: { ...csrfParam, path: { orgId, deviceId: input.device.id } },
            body: { ...input.body, version: input.device.version },
          })
        : await api.POST('/orgs/{orgId}/devices', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
}

export function useDeleteDevices(orgId: string) {
  const invalidate = useInvalidateDevices(orgId)
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await api.POST('/orgs/{orgId}/devices/bulk-delete', {
        params: { ...csrfParam, path: { orgId } },
        body: { ids },
      })
      if (r.data) return r.data.count
      fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
}

export function useBulkUpdateDevices(orgId: string) {
  const invalidate = useInvalidateDevices(orgId)
  return useMutation({
    mutationFn: async (body: DeviceBulkUpdate) => {
      const r = await api.POST('/orgs/{orgId}/devices/bulk-update', {
        params: { ...csrfParam, path: { orgId } },
        body,
      })
      if (r.data) return r.data.count
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
}

export function useCustomFields(orgId: string) {
  return useQuery({
    queryKey: keys.fields(orgId),
    enabled: orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/custom-fields', { params: { path: { orgId } } })
      if (r.data) return r.data.fields
      fail(r.error, r.response.status, i18n.t('errors.fieldsLoad'))
    },
  })
}

export function useCustomFieldMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: keys.fields(orgId) })
  const save = useMutation({
    mutationFn: async (input: {
      field?: CustomField
      body: {
        key: string
        label: string
        kind: CustomFieldKind
        options: string[]
        required: boolean
        sortOrder: number
      }
    }) => {
      const r = input.field
        ? await api.PATCH('/orgs/{orgId}/custom-fields/{fieldId}', {
            params: { ...csrfParam, path: { orgId, fieldId: input.field.id } },
            body: {
              label: input.body.label,
              options: input.body.options,
              required: input.body.required,
              sortOrder: input.body.sortOrder,
              version: input.field.version,
            },
          })
        : await api.POST('/orgs/{orgId}/custom-fields', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (fieldId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/custom-fields/{fieldId}', {
        params: { ...csrfParam, path: { orgId, fieldId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { save, remove }
}
