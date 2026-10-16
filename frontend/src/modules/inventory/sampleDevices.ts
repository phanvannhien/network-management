/**
 * Sample inventory for "Văn phòng mẫu" used by the redesigned device pages until the real
 * inventory API exists (P1-08). The fake list call mirrors a server-paginated endpoint
 * (filter + sort + page on the "server", returns items + total + facet counts) so the pages
 * switch to the API without structural changes. Deterministic: same data on every load.
 */
import type { Status } from '@/components/StatusBadge'

export type DeviceType =
  | 'firewall'
  | 'router'
  | 'core-switch'
  | 'l2-switch'
  | 'poe-switch'
  | 'ap'
  | 'server'
  | 'nas'
  | 'ups'
  | 'printer'
  | 'camera'

export type Lifecycle = 'active' | 'spare' | 'planned' | 'retired'

export interface SampleInterface {
  name: string
  type: 'physical' | 'lag' | 'vlan' | 'mgmt'
  media: 'RJ45' | 'SFP' | 'SFP+' | '—'
  speed: string
  mode: 'access' | 'trunk' | 'routed' | '—'
  vlan: string
  connectedTo: string | null
  status: Status
}

export interface SampleCredential {
  id: string
  protocol: 'SSH' | 'HTTPS' | 'SNMPv3' | 'Console'
  username: string
  /** Fake secret, revealed only through SecretField (stands in for the audited reveal API). */
  secret: string
}

export interface SampleDevice {
  id: string
  hostname: string
  mgmtIp: string
  prefix: number
  type: DeviceType
  vendor: string
  model: string
  partNumber: string
  serial: string
  mac: string
  firmware: string
  site: string
  location: string
  rack: string | null
  status: Status
  statusSince: string
  lifecycle: Lifecycle
  warrantyEnd: string | null
  role: string
  owner: string
  tags: string[]
}

export const TYPE_LABELS: Record<DeviceType, string> = {
  firewall: 'Firewall',
  router: 'Router',
  'core-switch': 'Core switch',
  'l2-switch': 'L2 switch',
  'poe-switch': 'PoE switch',
  ap: 'Access point',
  server: 'Server',
  nas: 'NAS',
  ups: 'UPS',
  printer: 'Máy in',
  camera: 'Camera',
}

export const SITES = ['HQ Hà Nội', 'CN Đà Nẵng', 'CN TP.HCM'] as const

interface Template {
  type: DeviceType
  prefix: string
  vendor: string
  model: string
  partNumber: string
  firmware: string
  role: string
  count: [number, number, number]
}

const TEMPLATES: Template[] = [
  {
    type: 'firewall',
    prefix: 'FW',
    vendor: 'Fortinet',
    model: 'FortiGate 100F',
    partNumber: 'FG-100F',
    firmware: 'FortiOS 7.4.5',
    role: 'Edge',
    count: [2, 1, 1],
  },
  {
    type: 'router',
    prefix: 'RT',
    vendor: 'Cisco',
    model: 'ISR 4331',
    partNumber: 'ISR4331/K9',
    firmware: 'IOS-XE 17.9.4',
    role: 'WAN',
    count: [1, 1, 1],
  },
  {
    type: 'core-switch',
    prefix: 'SW-CORE',
    vendor: 'Cisco',
    model: 'C9300-48UXM',
    partNumber: 'C9300-48UXM-E',
    firmware: 'IOS-XE 17.9.4',
    role: 'Core',
    count: [2, 1, 1],
  },
  {
    type: 'l2-switch',
    prefix: 'SW-ACC',
    vendor: 'Cisco',
    model: 'C9200-24P',
    partNumber: 'C9200-24P-E',
    firmware: 'IOS-XE 17.9.4',
    role: 'Access',
    count: [8, 3, 4],
  },
  {
    type: 'poe-switch',
    prefix: 'SW-POE',
    vendor: 'Aruba',
    model: 'CX 6100 24G',
    partNumber: 'JL677A',
    firmware: 'ArubaOS-CX 10.13',
    role: 'Access',
    count: [4, 2, 2],
  },
  {
    type: 'ap',
    prefix: 'AP',
    vendor: 'Ubiquiti',
    model: 'U6 Pro',
    partNumber: 'U6-PRO',
    firmware: 'UniFi 6.6.77',
    role: 'Wi-Fi',
    count: [14, 5, 6],
  },
  {
    type: 'server',
    prefix: 'SRV',
    vendor: 'Dell',
    model: 'PowerEdge R650',
    partNumber: 'R650-8SFF',
    firmware: 'iDRAC 7.10',
    role: 'Hypervisor',
    count: [4, 1, 1],
  },
  {
    type: 'nas',
    prefix: 'NAS',
    vendor: 'Synology',
    model: 'RS2423+',
    partNumber: 'RS2423+',
    firmware: 'DSM 7.2.2',
    role: 'Backup',
    count: [1, 1, 1],
  },
  {
    type: 'ups',
    prefix: 'UPS',
    vendor: 'APC',
    model: 'Smart-UPS 3000',
    partNumber: 'SMT3000RMI2UC',
    firmware: 'NMC 2.6',
    role: 'Nguồn',
    count: [2, 1, 1],
  },
  {
    type: 'printer',
    prefix: 'PRN',
    vendor: 'HP',
    model: 'LaserJet M507',
    partNumber: '1PV87A',
    firmware: '2409081',
    role: 'In ấn',
    count: [4, 2, 2],
  },
  {
    type: 'camera',
    prefix: 'CAM',
    vendor: 'Hikvision',
    model: 'DS-2CD2143G2',
    partNumber: 'DS-2CD2143G2-I',
    firmware: 'V5.7.15',
    role: 'An ninh',
    count: [10, 4, 4],
  },
]

const SITE_CODES = ['HQ', 'DN', 'HCM']
const SITE_NETS = ['10.72.114', '10.72.120', '10.72.130']
const OWNERS = ['Trần Kỹ Sư', 'Nguyễn Quản Trị', 'Lê Vận Hành']
const FLOORS = ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 5']

/** Small deterministic PRNG (mulberry32) so screenshots are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hex(n: number, width: number) {
  return n.toString(16).toUpperCase().padStart(width, '0')
}

function build(): SampleDevice[] {
  const rand = rng(20261016)
  const out: SampleDevice[] = []
  let serialN = 0x2312a0
  SITES.forEach((site, s) => {
    let host = 1
    for (const tpl of TEMPLATES) {
      for (let i = 1; i <= tpl.count[s]; i++) {
        const n = String(i).padStart(2, '0')
        const roll = rand()
        const status: Status =
          tpl.type === 'printer' && roll < 0.3
            ? 'notMonitored'
            : roll < 0.06
              ? 'down'
              : roll < 0.14
                ? 'warning'
                : roll < 0.19
                  ? 'planned'
                  : roll < 0.22
                    ? 'unknown'
                    : 'up'
        const lifecycle: Lifecycle =
          status === 'planned' ? 'planned' : rand() < 0.05 ? 'spare' : 'active'
        const inRack = ['firewall', 'router', 'core-switch', 'server', 'nas', 'ups'].includes(
          tpl.type,
        )
        const floor = FLOORS[Math.floor(rand() * FLOORS.length)]
        const warrantyYear = 2025 + Math.floor(rand() * 4)
        const warrantyMonth = 1 + Math.floor(rand() * 12)
        const macTail = Math.floor(rand() * 0xffffff)
        serialN += 1 + Math.floor(rand() * 40)
        out.push({
          id: `dev-${SITE_CODES[s].toLowerCase()}-${tpl.prefix.toLowerCase()}-${n}`,
          hostname: `${tpl.prefix}-${SITE_CODES[s]}-${n}`,
          mgmtIp: `${SITE_NETS[s]}.${host++}`,
          prefix: 24,
          type: tpl.type,
          vendor: tpl.vendor,
          model: tpl.model,
          partNumber: tpl.partNumber,
          serial:
            tpl.type === 'camera' && rand() < 0.2
              ? ''
              : `FOC${hex(serialN, 6)}X${hex(Math.floor(rand() * 255), 2)}`,
          mac: `00:1B:54:${hex((macTail >> 16) & 0xff, 2)}:${hex((macTail >> 8) & 0xff, 2)}:${hex(macTail & 0xff, 2)}`,
          firmware: tpl.firmware,
          site,
          location: inRack ? 'Phòng máy chủ' : floor,
          rack: inRack ? `Rack ${String.fromCharCode(65 + (i % 3))} · U${10 + i * 2}` : null,
          status,
          statusSince: `2026-10-${String(1 + Math.floor(rand() * 15)).padStart(2, '0')}T0${Math.floor(rand() * 9)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00+07:00`,
          lifecycle,
          warrantyEnd:
            tpl.type === 'camera' && rand() < 0.4
              ? null
              : `${warrantyYear}-${String(warrantyMonth).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`,
          role: tpl.role,
          owner: OWNERS[Math.floor(rand() * OWNERS.length)],
          tags: s === 0 && tpl.type === 'core-switch' ? ['critical'] : [],
        })
      }
    }
  })
  return out
}

export const SAMPLE_DEVICES: SampleDevice[] = build()

export type SortKey = 'hostname' | 'mgmtIp' | 'type' | 'model' | 'site' | 'status' | 'warrantyEnd'

export interface ListParams {
  q: string
  facets: Record<string, string[]>
  sort: { id: SortKey; desc: boolean } | null
  pageIndex: number
  pageSize: number
}

export interface ListResult {
  items: SampleDevice[]
  total: number
  /** Counts per facet value over the result filtered by everything except that facet. */
  facetCounts: Record<string, Record<string, number>>
}

const ipKey = (ip: string) =>
  ip
    .split('.')
    .map((p) => p.padStart(3, '0'))
    .join('.')

const STATUS_ORDER: Status[] = ['down', 'warning', 'unknown', 'up', 'planned', 'notMonitored']

function matches(d: SampleDevice, q: string): boolean {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  return [d.hostname, d.mgmtIp, d.serial, d.mac, d.model, d.partNumber].some((v) =>
    v.toLowerCase().includes(needle),
  )
}

const FACET_FIELDS: Record<string, (d: SampleDevice) => string> = {
  site: (d) => d.site,
  type: (d) => d.type,
  status: (d) => d.status,
}

function applyFacets(list: SampleDevice[], facets: Record<string, string[]>, skip?: string) {
  return list.filter((d) =>
    Object.entries(facets).every(
      ([id, values]) =>
        id === skip || values.length === 0 || values.includes(FACET_FIELDS[id]?.(d) ?? ''),
    ),
  )
}

/** Fake `GET /orgs/{orgId}/devices?q=&site=&type=&status=&sort=&page=&pageSize=`. */
export async function listSampleDevices(p: ListParams, delayMs = 120): Promise<ListResult> {
  await new Promise((r) => setTimeout(r, delayMs))
  const searched = SAMPLE_DEVICES.filter((d) => matches(d, p.q))
  const filtered = applyFacets(searched, p.facets)
  if (p.sort) {
    const { id, desc } = p.sort
    const key = (d: SampleDevice): string =>
      id === 'mgmtIp'
        ? ipKey(d.mgmtIp)
        : id === 'status'
          ? String(STATUS_ORDER.indexOf(d.status))
          : id === 'warrantyEnd'
            ? (d.warrantyEnd ?? '9999')
            : id === 'type'
              ? TYPE_LABELS[d.type]
              : d[id]
    filtered.sort((a, b) => key(a).localeCompare(key(b), 'vi', { numeric: true }) * (desc ? -1 : 1))
  }
  const facetCounts: ListResult['facetCounts'] = {}
  for (const id of Object.keys(FACET_FIELDS)) {
    const counts: Record<string, number> = {}
    for (const d of applyFacets(searched, p.facets, id)) {
      const v = FACET_FIELDS[id](d)
      counts[v] = (counts[v] ?? 0) + 1
    }
    facetCounts[id] = counts
  }
  const start = p.pageIndex * p.pageSize
  return { items: filtered.slice(start, start + p.pageSize), total: filtered.length, facetCounts }
}

export async function getSampleDevice(id: string, delayMs = 80): Promise<SampleDevice | null> {
  await new Promise((r) => setTimeout(r, delayMs))
  return SAMPLE_DEVICES.find((d) => d.id === id) ?? null
}

/** Port list for the detail page's Interfaces tab. */
export function sampleInterfaces(d: SampleDevice): SampleInterface[] {
  const rand = rng(d.hostname.length * 7919 + d.mgmtIp.length)
  const peers = SAMPLE_DEVICES.filter((x) => x.site === d.site && x.id !== d.id)
  const port = (name: string, i: number, uplink = false): SampleInterface => {
    const connected = uplink || rand() < 0.7
    const peer = peers[Math.floor(rand() * peers.length)]
    return {
      name,
      type: 'physical',
      media: uplink ? 'SFP+' : 'RJ45',
      speed: uplink ? '10G' : '1G',
      mode: uplink ? 'trunk' : 'access',
      vlan: uplink ? '10,20,30,99' : String([10, 20, 30][i % 3]),
      connectedTo: connected && peer ? `${peer.hostname} › ${uplink ? 'Te1/1/1' : 'eth0'}` : null,
      status: !connected
        ? 'notMonitored'
        : d.status === 'down'
          ? 'down'
          : rand() < 0.05
            ? 'warning'
            : 'up',
    }
  }
  if (d.type === 'l2-switch' || d.type === 'poe-switch' || d.type === 'core-switch') {
    const n = d.type === 'core-switch' ? 12 : 24
    const prefix = d.vendor === 'Aruba' ? '1/1/' : 'Gi1/0/'
    return [
      ...Array.from({ length: n }, (_, i) => port(`${prefix}${i + 1}`, i)),
      port('Te1/1/1', 0, true),
      port('Te1/1/2', 1, true),
      {
        name: 'Vlan99',
        type: 'vlan',
        media: '—',
        speed: '—',
        mode: 'routed',
        vlan: '99',
        connectedTo: null,
        status: d.status,
      },
    ]
  }
  if (d.type === 'firewall' || d.type === 'router') {
    return ['wan1', 'wan2', 'port1', 'port2', 'port3', 'port4', 'mgmt'].map((name, i) => ({
      ...port(name, i, i < 2),
      type: name === 'mgmt' ? 'mgmt' : 'physical',
      mode: 'routed',
      vlan: '—',
    }))
  }
  return [{ ...port('eth0', 0), name: 'eth0' }]
}

export function sampleCredentials(d: SampleDevice): SampleCredential[] {
  if (d.type === 'printer' || d.type === 'camera' || d.type === 'ap') {
    return [{ id: `${d.id}-web`, protocol: 'HTTPS', username: 'admin', secret: 'Sample-Web-2026!' }]
  }
  return [
    { id: `${d.id}-ssh`, protocol: 'SSH', username: 'netadmin', secret: 'Sample-Ssh-Pa55w0rd' },
    { id: `${d.id}-snmp`, protocol: 'SNMPv3', username: 'ntb-ro', secret: 'Sample-Snmp-AuthKey' },
  ]
}
