import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx'
import type { vi } from '@/i18n/vi'
import type { LinkKind } from '@/modules/inventory/links'
import type {
  BoqLine,
  ExpiringItem,
  InventoryRow,
  IpPlanRow,
  MissingInfoRow,
  PortMapDevice,
  VlanReportRow,
} from './reports'

// Report workbooks (P2-11, SRS §12): built in the browser from the report data with SheetJS. No secret is in any
// report. The IP plan keeps the column names the IPAM import reads (P2-09), so the file goes out and comes back in.

export interface SheetData {
  name: string
  rows: (string | number)[][]
}

type Cell = string | number
type Col = keyof (typeof vi)['reports']['cols']

/**
 * Excel sheet names: ≤ 31 characters, none of []:*?/\, no quote at either end, not "History" (reserved), unique in
 * the workbook.
 */
export function sheetName(raw: string, taken: Set<string>): string {
  let base =
    raw
      .replace(/[[\]:*?/\\]/g, '-')
      .replace(/^'+|'+$/g, '')
      .slice(0, 31) || 'Sheet'
  if (base.toLowerCase() === 'history') base = `${base}~`
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()); i++)
    name = `${base.slice(0, 31 - `~${i}`.length)}~${i}`
  taken.add(name.toLowerCase())
  return name
}

export function downloadWorkbook(sheets: SheetData[], filename: string) {
  const wb = XLSX.utils.book_new()
  const taken = new Set<string>()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    const widths = (s.rows[0] ?? []).map((_, c) =>
      Math.min(50, Math.max(8, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))),
    )
    ws['!cols'] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name, taken))
  }
  XLSX.writeFile(wb, filename)
}

const rangesOf = (r: IpPlanRow, kind: string) =>
  r.ranges
    .filter((x) => x.kind === kind)
    .map((x) => `${x.startIp}-${x.endIp}`)
    .join('; ')

/** IP plan: one row per subnet (importable), then one row per range (importable too, as the template has it). */
export function ipPlanSheets(rows: IpPlanRow[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  const plan: Cell[][] = [
    [
      h('site'),
      h('vlan'),
      h('vlanName'),
      h('subnet'),
      h('mask'),
      h('gateway'),
      h('vrf'),
      h('description'),
      h('dhcp'),
      h('staticRange'),
      h('reservedRange'),
      h('size'),
      h('used'),
      h('usedPct'),
    ],
    ...rows.map((r) => [
      r.siteCode,
      r.vlanVid ?? '',
      r.vlanName,
      r.cidr,
      r.mask,
      r.gateway,
      r.vrf,
      r.description,
      rangesOf(r, 'dhcp'),
      rangesOf(r, 'static'),
      rangesOf(r, 'reserved'),
      r.size,
      r.used,
      r.size > 0 ? Math.round((r.used / r.size) * 100) : 0,
    ]),
  ]
  const ranges: Cell[][] = [
    [h('site'), h('subnet'), h('rangeStart'), h('rangeEnd'), h('rangeKind'), h('purpose')],
    ...rows.flatMap((r) =>
      r.ranges.map((x) => [
        r.siteCode,
        r.cidr,
        x.startIp,
        x.endIp,
        t(`ipam.rangeKinds.${x.kind}`),
        x.purpose,
      ]),
    ),
  ]
  return [
    { name: t('reports.sheets.ipPlan'), rows: plan },
    { name: t('reports.sheets.ranges'), rows: ranges },
  ]
}

export function vlanSheets(rows: VlanReportRow[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  return [
    {
      name: 'VLAN',
      rows: [
        [
          h('vlan'),
          h('vlanName'),
          h('site'),
          h('subnet'),
          h('gateway'),
          h('accessPorts'),
          h('trunkPorts'),
          h('description'),
        ],
        ...rows.map((v) => [
          v.vid,
          v.name,
          v.siteCode || t('reports.orgWide'),
          v.subnets.join(', '),
          v.gateways.join(', '),
          v.accessPorts,
          v.trunkPorts,
          v.description,
        ]),
      ],
    },
  ]
}

/** Devices that get a sheet of their own in the port map: the network gear and patch panels (not PCs, cameras…). */
const OWN_SHEET = new Set([
  'router',
  'l3_switch',
  'l2_switch',
  'poe_switch',
  'firewall',
  'load_balancer',
  'wireless_controller',
  'vpn_gateway',
  'sdwan_edge',
  'olt',
  'media_converter',
  'wireless_bridge',
  'patch_panel',
  'console_server',
])

function portCells(p: PortMapDevice['ports'][number], t: TFunction): Cell[] {
  return [
    p.name,
    p.description,
    p.adminUp ? t('reports.up') : t('reports.down'),
    p.mode,
    p.accessVlan ?? '',
    p.nativeVlan ?? '',
    p.allowedVlans,
    p.speed,
    p.duplex,
    p.media,
    p.poe ? t('reports.yes') : '',
    p.lag,
    p.peerName,
    p.peerPort,
    p.cableId,
    p.linkKind ? t(`links.kinds.${p.linkKind as LinkKind}`) : '',
  ]
}

/** Port map: everything on one sheet (to filter), then one sheet per switch / router / firewall / patch panel. */
export function portMapSheets(devices: PortMapDevice[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  const portHeader = [
    h('port'),
    h('description'),
    h('adminUp'),
    h('mode'),
    h('accessVlan'),
    h('nativeVlan'),
    h('allowedVlans'),
    h('speed'),
    h('duplex'),
    h('media'),
    h('poe'),
    h('lag'),
    h('peer'),
    h('peerPort'),
    h('cableId'),
    h('linkKind'),
  ]
  const all: SheetData = {
    name: t('reports.sheets.allPorts'),
    rows: [
      [h('device'), h('site'), ...portHeader],
      ...devices.flatMap((d) => d.ports.map((p) => [d.hostname, d.siteCode, ...portCells(p, t)])),
    ],
  }
  const own = devices
    .filter((d) => OWN_SHEET.has(d.type) && d.ports.length > 0)
    .map((d) => {
      const used = d.ports.filter((p) => p.peerKind !== '').length
      const title = [d.hostname, d.model, d.clusterName && `(${d.clusterName})`]
        .filter(Boolean)
        .join(' ')
      return {
        name: d.hostname,
        rows: [
          [title, t('reports.portsUsed', { used, total: d.ports.length })],
          portHeader,
          ...d.ports.map((p) => portCells(p, t)),
        ],
      }
    })
  return [all, ...own]
}

/** BOQ: one sheet per status (planned / in use / spare are never summed), one column per site. */
export function boqSheets(lines: BoqLine[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  const out: SheetData[] = []
  for (const lifecycle of ['planned', 'active', 'spare'] as const) {
    const list = lines.filter((l) => l.lifecycle === lifecycle)
    if (list.length === 0) continue
    const sites = [...new Set(list.flatMap((l) => l.sites.map((s) => s.siteCode)))].sort()
    out.push({
      name: t(`reports.boqSheets.${lifecycle}`),
      rows: [
        [
          h('no'),
          h('vendor'),
          h('model'),
          h('partNumber'),
          h('type'),
          h('quantity'),
          h('unit'),
          ...sites,
          h('notes'),
        ],
        ...list.map((l, i) => [
          i + 1,
          l.vendor,
          l.model,
          l.partNumber,
          t(`devices.types.${l.type}`),
          l.quantity,
          t('reports.unit'),
          ...sites.map((s) => l.sites.find((x) => x.siteCode === s)?.quantity ?? ''),
          [
            !l.model && !l.partNumber ? t('reports.noModel') : '',
            l.clustered > 0 ? t('reports.clustered', { count: l.clustered }) : '',
          ]
            .filter(Boolean)
            .join('; '),
        ]),
        ['', '', '', '', t('reports.total'), list.reduce((n, l) => n + l.quantity, 0)],
      ],
    })
  }
  return out
}

/** Bucket of an expiry date: overdue, then within 30 / 60 / 90 days (beyond: the window asked for). */
export function expiryBucket(days: number): 'overdue' | 'd30' | 'd60' | 'd90' | 'later' {
  if (days < 0) return 'overdue'
  if (days <= 30) return 'd30'
  if (days <= 60) return 'd60'
  if (days <= 90) return 'd90'
  return 'later'
}

export function expiringSheets(items: ExpiringItem[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  return [
    {
      name: t('reports.tabs.expiring'),
      rows: [
        [
          h('bucket'),
          h('kind'),
          h('subject'),
          h('detail'),
          h('site'),
          h('status'),
          h('supplier'),
          h('date'),
          h('daysLeft'),
          h('muted'),
        ],
        ...items.map((i) => [
          t(`reports.buckets.${expiryBucket(i.days)}`),
          t(`reports.expiryKinds.${i.kind}`),
          i.subject,
          i.detail,
          i.siteCode,
          i.lifecycle ? t(`devices.lifecycleValues.${i.lifecycle as Lifecycle}`) : '',
          i.vendor,
          i.date,
          i.days,
          i.muted ? t('reports.yes') : '',
        ]),
      ],
    },
  ]
}

export function missingSheets(rows: MissingInfoRow[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  return [
    {
      name: t('reports.tabs.missing'),
      rows: [
        [h('device'), h('site'), h('type'), h('vendor'), h('model'), h('missing')],
        ...rows.map((d) => [
          d.hostname,
          d.siteCode,
          t(`devices.types.${d.type}`),
          d.vendor,
          d.model,
          d.missing.map((m) => t(`dashboard.field.${m}`)).join(', '),
        ]),
      ],
    },
  ]
}

const LIFECYCLES = ['planned', 'active', 'spare', 'rma', 'retired'] as const
type Lifecycle = (typeof LIFECYCLES)[number]

/** Counts by site (a column per status), by type and by vendor (devices not retired). */
export function inventorySheets(rows: InventoryRow[], t: TFunction): SheetData[] {
  const h = (k: Col): string => t(`reports.cols.${k}`)
  const live = rows.filter((r) => r.lifecycle !== 'retired')
  const sum = (list: InventoryRow[]) => list.reduce((n, r) => n + r.quantity, 0)
  const group = (list: InventoryRow[], key: (r: InventoryRow) => string) => {
    const m = new Map<string, InventoryRow[]>()
    for (const r of list) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return m
  }
  const bySite = [...group(rows, (r) => r.siteCode)].map(([code, list]) => [
    code,
    list[0]!.siteName,
    ...LIFECYCLES.map((l) => sum(list.filter((r) => r.lifecycle === l)) || ''),
    sum(list.filter((r) => r.lifecycle !== 'retired')),
  ])
  const byType = [...group(live, (r) => r.type)]
    .map(
      ([type, list]) => [t(`devices.types.${type as InventoryRow['type']}`), sum(list)] as Cell[],
    )
    .sort((a, b) => (b[1] as number) - (a[1] as number))
  const byVendor = [...group(live, (r) => r.vendor || '—')]
    .map(([vendor, list]) => [vendor, sum(list)] as Cell[])
    .sort((a, b) => (b[1] as number) - (a[1] as number))
  return [
    {
      name: t('reports.sheets.bySite'),
      rows: [
        [
          h('site'),
          h('siteName'),
          ...LIFECYCLES.map((l) => t(`devices.lifecycleValues.${l}`)),
          h('inUseTotal'),
        ],
        ...bySite,
      ],
    },
    { name: t('reports.sheets.byType'), rows: [[h('type'), h('quantity')], ...byType] },
    { name: t('reports.sheets.byVendor'), rows: [[h('vendor'), h('quantity')], ...byVendor] },
  ]
}
