import type { DeviceGroup, DeviceTemplate } from './types'

export const DEVICE_GROUP_ORDER: DeviceGroup[] = [
  'core_routing',
  'access_switching',
  'security',
  'end_devices',
  'cloud_wan',
  'other',
]

/** Display names for the groups (i18n key: `group.<id>` from P1-12). */
export const DEVICE_GROUP_LABELS: Record<DeviceGroup, string> = {
  core_routing: 'Core & Routing',
  access_switching: 'Access & Switching',
  security: 'Security',
  end_devices: 'End Devices',
  cloud_wan: 'Cloud & WAN',
  other: 'Other',
}

const ETH = { media: 'rj45', speed: '1G' } as const
const FAST = { media: 'rj45', speed: '100M' } as const
const SFP = { media: 'sfp', speed: '1G' } as const
const SFP_PLUS = { media: 'sfp_plus', speed: '10G' } as const
const NO_PORTS = [] as const

/** Catalog for the 5 base device groups + Other (SRS §2). */
export const DEVICE_TEMPLATES: DeviceTemplate[] = [
  // Core & Routing
  {
    typeId: 'router',
    group: 'core_routing',
    label: 'Router',
    portRuns: [
      { prefix: 'Gi0/0/', count: 3, start: 0, ...ETH, mode: 'routed' },
      { prefix: 'Te0/1/', count: 1, start: 0, ...SFP_PLUS, mode: 'routed' },
    ],
  },
  {
    typeId: 'l3_switch',
    group: 'core_routing',
    label: 'L3 Switch',
    portRuns: [
      { prefix: 'Gi1/0/', count: 24, ...ETH },
      { prefix: 'Te1/1/', count: 4, ...SFP_PLUS, mode: 'trunk' },
    ],
  },
  {
    typeId: 'load_balancer',
    group: 'core_routing',
    label: 'Load Balancer',
    portRuns: [{ prefix: 'port', count: 4, ...SFP_PLUS }],
  },
  {
    typeId: 'wireless_controller',
    group: 'core_routing',
    label: 'Wireless Controller',
    portRuns: [
      { prefix: 'port', count: 4, ...ETH },
      { prefix: 'Te', count: 2, ...SFP_PLUS },
    ],
  },

  // Access & Switching
  {
    typeId: 'l2_switch',
    group: 'access_switching',
    label: 'L2 Switch',
    portRuns: [
      { prefix: 'Gi1/0/', count: 24, ...ETH },
      { prefix: 'Gi1/1/', count: 4, ...SFP, mode: 'trunk' },
    ],
  },
  {
    typeId: 'poe_switch',
    group: 'access_switching',
    label: 'PoE Switch',
    portRuns: [
      { prefix: 'Gi1/0/', count: 24, ...ETH, poe: true },
      { prefix: 'Te1/1/', count: 2, ...SFP_PLUS, mode: 'trunk' },
    ],
  },
  {
    typeId: 'hub',
    group: 'access_switching',
    label: 'Hub',
    portRuns: [{ prefix: 'port', count: 8, ...FAST }],
  },
  {
    typeId: 'access_point',
    group: 'access_switching',
    label: 'Access Point',
    portRuns: [
      { prefix: 'eth', count: 1, ...ETH, poe: true },
      { prefix: 'radio', count: 2, media: 'radio', speed: 'auto' },
    ],
  },
  {
    typeId: 'media_converter',
    group: 'access_switching',
    label: 'Media Converter',
    portRuns: [
      { prefix: 'tp', count: 1, ...ETH },
      { prefix: 'fo', count: 1, media: 'fiber_mm', speed: '1G' },
    ],
  },
  {
    typeId: 'patch_panel',
    group: 'access_switching',
    label: 'Patch Panel',
    portRuns: [{ prefix: 'port', count: 24, ...ETH }],
  },

  // Security
  {
    typeId: 'firewall',
    group: 'security',
    label: 'Firewall',
    portRuns: [{ prefix: 'port', count: 8, ...ETH, mode: 'routed' }],
  },
  {
    typeId: 'ids_ips',
    group: 'security',
    label: 'IDS/IPS',
    portRuns: [{ prefix: 'port', count: 2, ...SFP_PLUS }],
  },
  {
    typeId: 'vpn_gateway',
    group: 'security',
    label: 'VPN Gateway',
    portRuns: [{ prefix: 'port', count: 2, ...ETH }],
  },
  {
    typeId: 'waf',
    group: 'security',
    label: 'WAF',
    portRuns: [{ prefix: 'port', count: 2, ...ETH }],
  },
  {
    typeId: 'nac',
    group: 'security',
    label: 'NAC',
    portRuns: [{ prefix: 'port', count: 2, ...ETH }],
  },
  {
    typeId: 'proxy',
    group: 'security',
    label: 'Proxy',
    portRuns: [{ prefix: 'port', count: 2, ...ETH }],
  },

  // End Devices
  {
    typeId: 'pc',
    group: 'end_devices',
    label: 'PC',
    portRuns: [{ prefix: 'eth', count: 1, ...ETH }],
  },
  {
    typeId: 'laptop',
    group: 'end_devices',
    label: 'Laptop',
    portRuns: [{ prefix: 'eth', count: 1, ...ETH }],
  },
  {
    typeId: 'server',
    group: 'end_devices',
    label: 'Server',
    portRuns: [
      { prefix: 'eno', count: 4, ...ETH },
      { prefix: 'eno', count: 2, start: 5, ...SFP_PLUS },
    ],
  },
  {
    typeId: 'ip_camera',
    group: 'end_devices',
    label: 'IP Camera',
    portRuns: [{ prefix: 'eth', count: 1, ...FAST }],
  },
  {
    typeId: 'nvr_dvr',
    group: 'end_devices',
    label: 'NVR/DVR',
    portRuns: [{ prefix: 'eth', count: 1, ...ETH }],
  },
  {
    typeId: 'printer',
    group: 'end_devices',
    label: 'Printer',
    portRuns: [{ prefix: 'eth', count: 1, ...FAST }],
  },
  {
    typeId: 'nas',
    group: 'end_devices',
    label: 'NAS',
    portRuns: [{ prefix: 'eth', count: 2, ...ETH }],
  },
  {
    typeId: 'ip_phone',
    group: 'end_devices',
    label: 'IP Phone',
    portRuns: [{ prefix: 'eth', count: 1, ...ETH, poe: true }],
  },
  {
    typeId: 'iot',
    group: 'end_devices',
    label: 'IoT Device',
    portRuns: [{ prefix: 'eth', count: 1, ...FAST }],
  },
  {
    typeId: 'vm',
    group: 'end_devices',
    label: 'VM',
    portRuns: [{ prefix: 'veth', count: 1, media: 'logical', speed: '10G' }],
  },

  // Cloud & WAN
  {
    typeId: 'cloud',
    group: 'cloud_wan',
    label: 'Cloud',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'internet_gateway',
    group: 'cloud_wan',
    label: 'Internet Gateway',
    portRuns: [{ prefix: 'port', count: 2, ...ETH }],
  },
  {
    typeId: 'modem',
    group: 'cloud_wan',
    label: 'Modem',
    portRuns: [{ prefix: 'port', count: 1, ...ETH }],
  },
  {
    typeId: 'isp',
    group: 'cloud_wan',
    label: 'ISP',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'mpls_cloud',
    group: 'cloud_wan',
    label: 'MPLS Cloud',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'sdwan_edge',
    group: 'cloud_wan',
    label: 'SD-WAN Edge',
    portRuns: [{ prefix: 'port', count: 4, ...ETH }],
  },
  {
    typeId: 'ont_olt',
    group: 'cloud_wan',
    label: 'ONT/OLT',
    portRuns: [
      { prefix: 'pon', count: 1, media: 'fiber_sm', speed: '1G' },
      { prefix: 'port', count: 4, ...ETH },
    ],
  },

  // Other
  {
    typeId: 'text_note',
    group: 'other',
    label: 'Text Note',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'zone',
    group: 'other',
    label: 'Zone',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'rack',
    group: 'other',
    label: 'Rack',
    portRuns: [...NO_PORTS],
  },
  {
    typeId: 'ups_pdu',
    group: 'other',
    label: 'UPS/PDU',
    portRuns: [{ prefix: 'outlet', count: 8, media: 'rj45', speed: 'auto' }],
  },
]

const TEMPLATES_BY_TYPE = new Map(DEVICE_TEMPLATES.map((t) => [t.typeId, t]))

export function getTemplate(typeId: DeviceTemplate['typeId']): DeviceTemplate {
  const template = TEMPLATES_BY_TYPE.get(typeId)
  if (!template) throw new Error(`no device template for type: ${typeId}`)
  return template
}

export function templatesByGroup(group: DeviceGroup): DeviceTemplate[] {
  return DEVICE_TEMPLATES.filter((t) => t.group === group)
}
