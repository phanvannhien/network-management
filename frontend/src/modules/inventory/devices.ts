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

export type DeviceTypeGroup =
  'wan' | 'lan' | 'security' | 'servers' | 'office' | 'building' | 'power'

/**
 * Device types grouped the way the network is laid out, from the Internet edge inward (SRS §4.3, P1-15 review):
 * used by selects, filters and the editor library. Labels: `devices.typeGroups`, one-line help: `devices.typeInfo`.
 */
export const DEVICE_TYPE_GROUPS: { group: DeviceTypeGroup; types: DeviceType[] }[] = [
  {
    group: 'wan',
    types: ['provider_cloud', 'router', 'modem', 'ont', 'olt', 'sdwan_edge', 'vpn_gateway'],
  },
  {
    group: 'lan',
    types: [
      'l3_switch',
      'l2_switch',
      'poe_switch',
      'wireless_controller',
      'access_point',
      'wireless_bridge',
      'media_converter',
      'patch_panel',
    ],
  },
  { group: 'security', types: ['firewall', 'ids_ips', 'waf', 'nac', 'proxy'] },
  { group: 'servers', types: ['server', 'vm', 'nas', 'load_balancer'] },
  { group: 'office', types: ['pc', 'laptop', 'printer', 'ip_phone', 'pbx', 'video_conference'] },
  { group: 'building', types: ['ip_camera', 'nvr', 'access_control', 'iot'] },
  { group: 'power', types: ['ups', 'pdu', 'console_server', 'other'] },
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
  | 'category'
  | 'lifecycle'
  | 'warrantyEnd'

export interface ListParams {
  q: string
  /** FilterBar facets: site, type, vendor, lifecycle, role, tag. */
  facets: Record<string, string[]>
  /** Topbar filter: sites of this category and below. */
  categoryId: string | null
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
            categoryId: p.categoryId ?? undefined,
            siteId: f.site?.length ? f.site : undefined,
            type: f.type?.length ? (f.type as DeviceType[]) : undefined,
            vendor: f.vendor?.length ? f.vendor : undefined,
            lifecycle: f.lifecycle?.length ? (f.lifecycle as DeviceLifecycle[]) : undefined,
            role: f.role?.length ? (f.role as DeviceRole[]) : undefined,
            tag: f.tag?.length ? f.tag : undefined,
            clusterId: f.cluster?.length ? f.cluster : undefined,
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

// --- templates, interfaces, IPs (P1-09, ADR-012) ---

export type DeviceTemplate = components['schemas']['DeviceTemplate']
export type DeviceTemplateInput = components['schemas']['DeviceTemplateInput']
export type PortGroup = components['schemas']['PortGroup']
export type Interface = components['schemas']['Interface']
export type InterfaceInput = components['schemas']['InterfaceInput']
export type InterfaceKind = components['schemas']['InterfaceKind']
export type InterfaceMedia = components['schemas']['InterfaceMedia']
export type InterfaceMode = components['schemas']['InterfaceMode']
export type IpAddress = components['schemas']['IpAddress']
export type IpAddressInput = components['schemas']['IpAddressInput']
export type IpRole = components['schemas']['IpRole']

export const INTERFACE_KINDS: InterfaceKind[] = [
  'physical',
  'svi',
  'loopback',
  'tunnel',
  'subinterface',
  'lag',
]
export const MEDIA: InterfaceMedia[] = [
  '',
  'RJ45',
  'SFP',
  'SFP+',
  'SFP28',
  'QSFP',
  'PON',
  'xDSL',
  'Serial',
  'Radio',
  'Console',
  'Cellular',
]
export const MODES: InterfaceMode[] = ['', 'access', 'trunk', 'routed', 'hybrid']
export const IP_ROLES: IpRole[] = ['primary', 'secondary', 'nat', 'public']

/** The full update body of a device, to change one thing (e.g. the management interface) from a page. */
export function deviceToInput(d: Device): DeviceInput {
  return {
    hostname: d.hostname,
    type: d.type,
    vendor: d.vendor,
    model: d.model,
    partNumber: d.partNumber,
    serialNumber: d.serialNumber,
    assetTag: d.assetTag,
    firmware: d.firmware,
    role: d.role,
    lifecycle: d.lifecycle,
    managed: d.managed,
    ownerName: d.ownerName,
    poNumber: d.poNumber,
    purchaseDate: d.purchaseDate,
    warrantyEnd: d.warrantyEnd,
    licenseEnd: d.licenseEnd,
    eolDate: d.eolDate,
    eosDate: d.eosDate,
    notes: d.notes,
    tags: d.tags,
    customFields: d.customFields,
    siteId: d.siteId,
    locationId: d.locationId,
    rackId: d.rackId,
    rackU: d.rackU,
    uHeight: d.uHeight,
    mgmtInterfaceId: d.mgmtInterfaceId,
    pollAddress: d.pollAddress,
    clusterId: d.clusterId,
    clusterRole: d.clusterRole,
    clusterMemberNo: d.clusterMemberNo,
  }
}

const subKeys = {
  interfaces: (orgId: string, id: string) => ['orgs', orgId, 'devices', 'interfaces', id] as const,
  ips: (orgId: string, id: string) => ['orgs', orgId, 'devices', 'ips', id] as const,
  templates: (orgId: string) => ['orgs', orgId, 'device-templates'] as const,
}

export function useInterfaces(orgId: string, deviceId: string, enabled = true) {
  return useQuery({
    queryKey: subKeys.interfaces(orgId, deviceId),
    enabled: enabled && deviceId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/devices/{deviceId}/interfaces', {
        params: { path: { orgId, deviceId } },
      })
      if (r.data) return r.data.interfaces
      fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
    },
  })
}

export function useDeviceIps(orgId: string, deviceId: string, enabled = true) {
  return useQuery({
    queryKey: subKeys.ips(orgId, deviceId),
    enabled: enabled && deviceId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/devices/{deviceId}/ips', {
        params: { path: { orgId, deviceId } },
      })
      if (r.data) return r.data.ips
      fail(r.error, r.response.status, i18n.t('errors.devicesLoad'))
    },
  })
}

/** Interface / IP writes change the device (version, management IP, history): refresh all device data. */
export function useInterfaceMutations(orgId: string, deviceId: string) {
  const invalidate = useInvalidateDevices(orgId)
  const path = { orgId, deviceId }
  const save = useMutation({
    mutationFn: async (input: { iface?: Interface; body: InterfaceInput }) => {
      const r = input.iface
        ? await api.PATCH('/orgs/{orgId}/devices/{deviceId}/interfaces/{interfaceId}', {
            params: { ...csrfParam, path: { ...path, interfaceId: input.iface.id } },
            body: { ...input.body, version: input.iface.version },
          })
        : await api.POST('/orgs/{orgId}/devices/{deviceId}/interfaces', {
            params: { ...csrfParam, path },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (interfaceId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/devices/{deviceId}/interfaces/{interfaceId}', {
        params: { ...csrfParam, path: { ...path, interfaceId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
  const apply = useMutation({
    mutationFn: async (templateId: string) => {
      const r = await api.POST('/orgs/{orgId}/devices/{deviceId}/apply-template', {
        params: { ...csrfParam, path },
        body: { templateId },
      })
      if (r.data) return r.data.added
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  return { save, remove, apply }
}

export function useIpMutations(orgId: string, deviceId: string) {
  const invalidate = useInvalidateDevices(orgId)
  const path = { orgId, deviceId }
  const save = useMutation({
    mutationFn: async (input: { ip?: IpAddress; body: IpAddressInput }) => {
      const r = input.ip
        ? await api.PATCH('/orgs/{orgId}/devices/{deviceId}/ips/{ipId}', {
            params: { ...csrfParam, path: { ...path, ipId: input.ip.id } },
            body: { ...input.body, version: input.ip.version },
          })
        : await api.POST('/orgs/{orgId}/devices/{deviceId}/ips', {
            params: { ...csrfParam, path },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (ipId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/devices/{deviceId}/ips/{ipId}', {
        params: { ...csrfParam, path: { ...path, ipId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled: invalidate,
  })
  return { save, remove }
}

export function useTemplates(orgId: string, enabled = true) {
  return useQuery({
    queryKey: subKeys.templates(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/device-templates', { params: { path: { orgId } } })
      if (r.data) return r.data.templates
      fail(r.error, r.response.status, i18n.t('errors.templatesLoad'))
    },
  })
}

export function useTemplateMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: subKeys.templates(orgId) })
  const save = useMutation({
    mutationFn: async (input: { template?: DeviceTemplate; body: DeviceTemplateInput }) => {
      const r = input.template
        ? await api.PATCH('/orgs/{orgId}/device-templates/{templateId}', {
            params: { ...csrfParam, path: { orgId, templateId: input.template.id } },
            body: { ...input.body, version: input.template.version },
          })
        : await api.POST('/orgs/{orgId}/device-templates', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (templateId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/device-templates/{templateId}', {
        params: { ...csrfParam, path: { orgId, templateId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { save, remove }
}

/** Expand port groups like the server does (preview in the template form). */
export function expandPorts(groups: PortGroup[], member = 1): string[] {
  return groups.flatMap((g) =>
    Array.from({ length: Math.max(0, Math.min(g.count, 512)) }, (_, i) =>
      g.pattern.replaceAll('{n}', String(g.start + i)).replaceAll('{m}', String(member)),
    ),
  )
}

// --- clusters (P1-09b, ADR-027) ---

export type Cluster = components['schemas']['Cluster']
export type ClusterDetail = components['schemas']['ClusterDetail']
export type ClusterInput = components['schemas']['ClusterInput']
export type ClusterKind = components['schemas']['ClusterKind']
export type ClusterRole = components['schemas']['ClusterRole']

export const CLUSTER_KINDS: ClusterKind[] = [
  'ha_active_passive',
  'ha_active_active',
  'stack',
  'vpc',
  'vss',
  'other',
]
export const CLUSTER_ROLES: ClusterRole[] = ['primary', 'secondary', 'member']

const HA_TYPES: DeviceType[] = [
  'firewall',
  'router',
  'vpn_gateway',
  'load_balancer',
  'wireless_controller',
  'waf',
  'proxy',
  'ids_ips',
  'sdwan_edge',
  'server',
  'nas',
]
/** Device types per cluster kind, mirroring the server (ADR-027); 'other' is open. */
const CLUSTER_TYPES: Partial<Record<ClusterKind, DeviceType[]>> = {
  ha_active_passive: HA_TYPES,
  ha_active_active: HA_TYPES,
  stack: ['l2_switch', 'l3_switch', 'poe_switch'],
  vpc: ['l2_switch', 'l3_switch'],
  vss: ['l2_switch', 'l3_switch'],
}

/** A device of this type may join the cluster: its kind allows the type and the members share it. */
export function canJoinCluster(c: Cluster, type: DeviceType): boolean {
  const allowed = CLUSTER_TYPES[c.kind]
  return (!allowed || allowed.includes(type)) && (c.memberType === '' || c.memberType === type)
}

const clusterKeys = {
  all: (orgId: string) => ['orgs', orgId, 'clusters'] as const,
  one: (orgId: string, id: string) => ['orgs', orgId, 'clusters', id] as const,
}

export function useClusters(orgId: string, enabled = true) {
  return useQuery({
    queryKey: clusterKeys.all(orgId),
    enabled: enabled && orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/clusters', { params: { path: { orgId } } })
      if (r.data) return r.data.clusters
      fail(r.error, r.response.status, i18n.t('errors.clustersLoad'))
    },
  })
}

export function useCluster(orgId: string, clusterId: string | null) {
  return useQuery({
    queryKey: clusterKeys.one(orgId, clusterId ?? ''),
    enabled: Boolean(clusterId),
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/clusters/{clusterId}', {
        params: { path: { orgId, clusterId: clusterId ?? '' } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.clustersLoad'))
    },
  })
}

/** Cluster writes change member lists and device rows: refresh clusters and devices. */
export function useClusterMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: clusterKeys.all(orgId) }),
      qc.invalidateQueries({ queryKey: keys.all(orgId) }),
    ])
  const save = useMutation({
    mutationFn: async (input: { cluster?: Cluster; body: ClusterInput }) => {
      const r = input.cluster
        ? await api.PATCH('/orgs/{orgId}/clusters/{clusterId}', {
            params: { ...csrfParam, path: { orgId, clusterId: input.cluster.id } },
            body: { ...input.body, version: input.cluster.version },
          })
        : await api.POST('/orgs/{orgId}/clusters', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const remove = useMutation({
    mutationFn: async (clusterId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/clusters/{clusterId}', {
        params: { ...csrfParam, path: { orgId, clusterId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { save, remove }
}
