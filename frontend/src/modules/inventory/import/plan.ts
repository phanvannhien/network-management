import type { components } from '@/api/client'
import { DEVICE_TYPES } from '../devices'
import { norm } from './parse'

const DEVICE_TYPE_IDS = new Set<string>(DEVICE_TYPES)

// Device import plan (P1-21, SRS §12): find the header row, map columns to fields, map values (device kind → type,
// "Location" → site), infer vendor / model / template from the part number, propose clusters for rows sharing an IP.
// Pure functions: the page only renders and confirms what they propose.

export type DeviceType = components['schemas']['DeviceType']
type ImportRow = components['schemas']['DeviceImportRow']
type ImportCluster = components['schemas']['DeviceImportCluster']

export const FIELDS = [
  'category',
  'site',
  'hostname',
  'type',
  'mgmtIp',
  'partNumber',
  'model',
  'vendor',
  'serial',
  'owner',
  'notes',
  'mgmtInterface',
] as const
export type Field = (typeof FIELDS)[number] | 'secret' | 'ignore'

/**
 * Header aliases (normalized). The customer's file says "Site" for the company and "Location" for the place, and
 * "Category" for the kind of device (SRS §12) — so those words map to our Category / Site / device type.
 */
const ALIASES: Record<Exclude<Field, 'ignore'>, string[]> = {
  category: ['site', 'company', 'congty', 'khachhang', 'donvi', 'customer', 'danhmuc'],
  site: ['location', 'diadiem', 'chinhanh', 'vanphong', 'sitename', 'noilapdat'],
  hostname: ['hostname', 'host', 'tenthietbi', 'devicename', 'tenmay'],
  type: ['category', 'type', 'loai', 'loaithietbi', 'devicetype', 'kind', 'phanloai'],
  mgmtIp: [
    'ipaddressmgmt',
    'mgmtip',
    'ipmgmt',
    'ipquantri',
    'ip',
    'ipaddress',
    'managementip',
    'diachiip',
  ],
  partNumber: ['partnumber', 'pn', 'partno', 'mahang'],
  model: ['model', 'dongmay', 'modelname'],
  vendor: ['vendor', 'hang', 'hangsx', 'manufacturer', 'brand', 'nhasanxuat'],
  serial: ['sn', 'serial', 'serialnumber', 'soserial', 'serialno'],
  owner: ['personincharge', 'owner', 'nguoiphutrach', 'phutrach', 'pic'],
  notes: ['notes', 'note', 'ghichu', 'description', 'mota', 'remark'],
  mgmtInterface: ['mgmtinterface', 'interfacequantri', 'congquantri'],
  // Credentials never leave the browser: there is no vault yet (P2-02).
  secret: [
    'password',
    'pass',
    'matkhau',
    'pwd',
    'username',
    'user',
    'tendangnhap',
    'account',
    'secret',
    'community',
    'enable',
  ],
}

const fieldOf = (header: string): Field | null => {
  const h = norm(header)
  if (!h) return null
  for (const [f, words] of Object.entries(ALIASES)) if (words.includes(h)) return f as Field
  return null
}

export interface HeaderInfo {
  /** Index of the header row in the sheet. */
  index: number
  headers: string[]
  /** "Person in charge: GVN" lines above the table. */
  meta: Partial<Record<Field, string>>
}

/** The first row (of the first 20) with at least 3 known headers; lines above it may carry file-wide values. */
export function detectHeader(rows: string[][]): HeaderInfo | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const hits = rows[i]!.filter((c) => fieldOf(c) !== null).length
    if (hits >= 3) {
      const meta: HeaderInfo['meta'] = {}
      for (const r of rows.slice(0, i)) {
        const cells = r.filter(Boolean)
        for (let c = 0; c < cells.length - 1; c++) {
          const f = fieldOf(cells[c]!.replace(/:$/, ''))
          if (f && f !== 'secret' && f !== 'ignore') meta[f] = cells[c + 1]
        }
      }
      return { index: i, headers: rows[i]!, meta }
    }
  }
  return null
}

/** Column → field; each field once (first column wins), password-like columns forced to secret. */
export function autoMap(headers: string[]): Field[] {
  const used = new Set<Field>()
  return headers.map((h) => {
    const f = fieldOf(h)
    if (f === 'secret') return 'secret'
    if (!f || used.has(f)) return 'ignore'
    used.add(f)
    return f
  })
}

/** A header that must stay unmapped (credentials). */
export const isSecretHeader = (h: string) => fieldOf(h) === 'secret'

/** Data rows under the header: stop at the first fully blank row, skip repeated header rows. */
export function dataRows(
  rows: string[][],
  header: HeaderInfo,
): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = []
  for (let i = header.index + 1; i < rows.length; i++) {
    const cells = rows[i]!
    if (cells.every((c) => !c)) break
    if (cells.join('|') === header.headers.join('|')) continue
    out.push({ line: i + 1, cells })
  }
  return out
}

/** Device kind text (and part number, for PoE) → device type; null = not recognised. */
export function typeFromText(text: string, partNumber = ''): DeviceType | null {
  // An exported file writes the type id itself (l2_switch, vpn_gateway…).
  const id = text.trim().toLowerCase()
  if (DEVICE_TYPE_IDS.has(id)) return id as DeviceType
  const t = norm(text)
  if (!t) return null
  const poe = /-\d+[a-z]*(fp|lp|mp|p)(-|$)/i.test(partNumber)
  const table: [RegExp, DeviceType][] = [
    [/^(firewall|fw|tuonglua|utm|ngfw)/, 'firewall'],
    [/^(router|rt|dinhtuyen|bodinhtuyen)/, 'router'],
    [/^(coreswitch|l3switch|switchl3|switchcore|multilayer)/, 'l3_switch'],
    [/^(poeswitch|switchpoe)/, 'poe_switch'],
    [/^(switch|sw|l2switch|switchl2|accessswitch|bochuyenmach)/, poe ? 'poe_switch' : 'l2_switch'],
    [/^(accesspoint|ap|wifi|bophatwifi|wap)$/, 'access_point'],
    [/^(wlc|wirelesscontroller|controller)/, 'wireless_controller'],
    [/^(server|maychu|sv)/, 'server'],
    [/^(nas|storage)/, 'nas'],
    [/^(camera|ipcamera|cam)/, 'ip_camera'],
    [/^(nvr|dvr|daughi)/, 'nvr'],
    [/^(ups|luudien)/, 'ups'],
    [/^pdu/, 'pdu'],
    [/^modem/, 'modem'],
    [/^ont$/, 'ont'],
    [/^(printer|mayin)/, 'printer'],
    [/^(ipphone|phone|dienthoai)/, 'ip_phone'],
    [/^(loadbalancer|lb)/, 'load_balancer'],
    [/^(pc|desktop|maytinh)/, 'pc'],
    [/^laptop/, 'laptop'],
  ]
  for (const [re, type] of table) if (re.test(t)) return type
  return null
}

/** Vendor and model from what the file calls "PartNumber" ("FortiGate 80F" is a model; "FG-80F" a part number). */
export function inferProduct(text: string): { vendor: string; model: string; partNumber: string } {
  const v = text.trim()
  const fg = /^(?:fortigate|fg)[\s-]*(\d+[a-z]*)$/i.exec(v)
  if (fg) {
    const n = fg[1]!.toUpperCase()
    return {
      vendor: 'Fortinet',
      model: `FortiGate ${n}`,
      partNumber: /^fg-/i.test(v) ? `FG-${n}` : '',
    }
  }
  const vendors: [RegExp, string][] = [
    [
      /^(isr|asr|cbs|c1[0-9]00|c9\d{3}|ws-c|c8\d{3}|catalyst|n[3579]k|nexus|air-|sg\d{3}|meraki|mr\d|ms\d)/i,
      'Cisco',
    ],
    [/^(fortiswitch|fs-|fortiap|fap-)/i, 'Fortinet'],
    [/^(usw|uap|udm|usg|u6)/i, 'Ubiquiti'],
    [/^(ex|srx|qfx|mx)\d/i, 'Juniper'],
    [/^pa-\d/i, 'Palo Alto'],
    [/^(ccr|crs|rb)\d/i, 'MikroTik'],
    [/^(jl\d|aruba|ap-\d)/i, 'HPE Aruba'],
  ]
  const vendor = vendors.find(([re]) => re.test(v))?.[1] ?? ''
  // Cisco "/K9" (crypto) and similar suffixes are part of the part number, not the model.
  const model = v.replace(/\/k9$/i, '')
  return { vendor, model, partNumber: v }
}

/** Org template matching the part number or model (case / punctuation-insensitive). */
export function matchTemplate<
  T extends { id: string; partNumber: string; model: string; type: string },
>(templates: T[], p: { partNumber: string; model: string }, type: string): T | undefined {
  const keys = [p.partNumber, p.model].map(norm).filter(Boolean)
  return templates.find(
    (t) => t.type === type && keys.some((k) => k === norm(t.partNumber) || k === norm(t.model)),
  )
}

/**
 * Catalog model (ADR-035) for what a file / device calls its product: exact match on model, part number or alias,
 * ignoring case, spaces and punctuation ("FortiGate 80F" = "FG-80F"? only if listed as an alias / part number).
 */
export function matchCatalog<
  C extends { model: string; partNumbers: string[]; aliases: string[]; type: string },
>(models: C[], texts: string[], type?: string | null): C | undefined {
  const keys = texts.map(norm).filter(Boolean)
  if (keys.length === 0) return undefined
  const hits = models.filter((m) =>
    [m.model, ...m.partNumbers, ...m.aliases].some((x) => keys.includes(norm(x))),
  )
  // Same name, different kind (a switch and its PoE twin share a family name): prefer the row's type.
  return hits.find((m) => m.type === type) ?? hits[0]
}

/** Place-name key: no diacritics, aliases for the big cities ("Hochiminh", "TP.HCM", "Ho Chi Minh" → hcm). */
export function placeKey(v: string): string {
  return norm(v)
    .replace(/(thanhpho|tp)?(hochiminh|hcmc|hcm|saigon)/g, 'hcm')
    .replace(/(thanhpho|tp)?hanoi/g, 'hn')
    .replace(/danang/g, 'dn')
}

const distance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return d[a.length]![b.length]!
}

/** Words that say what kind of place it is, not which one ("Văn phòng Hồ Chí Minh (HQ)" → the core is "hcm"). */
const GENERIC = new Set([
  'van',
  'phong',
  'vanphong',
  'office',
  'chi',
  'nhanh',
  'chinhanh',
  'branch',
  'hq',
  'headquarter',
  'headquarters',
  'tru',
  'so',
  'chinh',
  'nha',
  'may',
  'nhamay',
  'factory',
  'plant',
  'kho',
  'warehouse',
  'idc',
  'datacenter',
  'dc',
  'site',
  'cua',
  'hang',
  'store',
  'shop',
])

/** Place key without the generic words; "" when nothing is left. */
export function placeCore(v: string): string {
  const words = v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  // "Ho Chi Minh": keep the city together before dropping "chi" as a generic word.
  const joined = words
    .join(' ')
    .replace(/\bho chi minh\b/g, 'hochiminh')
    .replace(/\bha noi\b/g, 'hanoi')
  return placeKey(
    joined
      .split(' ')
      .filter((w) => !GENERIC.has(w))
      .join(''),
  )
}

export interface SiteLike {
  id: string
  code: string
  localCode: string
  name: string
  categoryId: string | null
}

export interface SiteMatch {
  /** exact = taken without asking; proposal = needs a click; none = pick or create. */
  kind: 'exact' | 'proposal' | 'none'
  siteId: string | null
  candidates: string[]
}

/**
 * Site for a Location value, looking first in the category the row's company maps to, then at sites straight under
 * the organization (shared places like an IDC), then elsewhere. Only an exact name / code match is automatic.
 */
export function matchSite(
  location: string,
  categoryId: string | null,
  sites: SiteLike[],
): SiteMatch {
  const key = placeKey(location)
  if (!key) return { kind: 'none', siteId: null, candidates: [] }
  const rank = (s: SiteLike) => (s.categoryId === categoryId ? 0 : s.categoryId === null ? 1 : 2)
  const ordered = [...sites].sort((a, b) => rank(a) - rank(b))
  const keysOf = (s: SiteLike) => [placeKey(s.name), placeKey(s.localCode), placeKey(s.code)]
  const exact = ordered.find((s) => rank(s) < 2 && keysOf(s).includes(key))
  if (exact) return { kind: 'exact', siteId: exact.id, candidates: [exact.id] }
  // Same core name counts as near too ("Binh Dinh Factory" ↔ "Bình Định – nhà máy"), and so does a local code
  // without its number ("HCM" ↔ HCM01 — a proposal: HCM02 may exist too). 0 = same core name, 1 = code stem, 2 = other.
  const core = placeCore(location)
  const closeness = (x: SiteLike) =>
    core !== '' && placeCore(x.name) === core
      ? 0
      : placeKey(x.localCode).replace(/\d+$/, '') === key
        ? 1
        : 2
  const near = ordered.filter(
    (s) =>
      closeness(s) < 2 ||
      keysOf(s).some(
        (k) =>
          k &&
          (k.includes(key) || key.includes(k) || distance(k, key) <= Math.min(2, key.length >> 2)),
      ),
  )
  if (near.length > 0) {
    // Best first: the row's own category before shared and other sites, then the closest name ("Hochiminh" ↔
    // "Văn phòng Hồ Chí Minh (HQ)", not "FPT IDC HCM").
    near.sort((a, b) => rank(a) - rank(b) || closeness(a) - closeness(b))
    return { kind: 'proposal', siteId: near[0]!.id, candidates: near.map((s) => s.id) }
  }
  return { kind: 'none', siteId: null, candidates: [] }
}

/** Category for a company value: by name or code, diacritics / spaces ignored. */
export function matchCategory<C extends { id: string; name: string; code: string }>(
  value: string,
  categories: C[],
): C | undefined {
  const k = norm(value)
  return k ? categories.find((c) => norm(c.name) === k || norm(c.code) === k) : undefined
}

/** A short code for a new site from its name: city alias, else initials (up to 4) + "01". */
export function suggestSiteCode(name: string, taken: Set<string>): string {
  const key = placeKey(name)
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
  let base =
    key === 'hcm'
      ? 'HCM'
      : key === 'hn'
        ? 'HN'
        : key === 'dn'
          ? 'DN'
          : words
              .map((w) => w[0])
              .join('')
              .slice(0, 4)
  if (base.length < 2) base = (words[0] ?? 'SITE').slice(0, 4)
  for (let n = 1; n < 100; n++) {
    const code = `${base}${String(n).padStart(2, '0')}`
    if (!taken.has(code)) return code
  }
  return base
}

export interface PlannedRow {
  line: number
  hostname: string
  /** Text cells as read, for the preview. */
  raw: Partial<Record<Field, string>>
  type: DeviceType | null
  siteId: string | null
  vendor: string
  model: string
  partNumber: string
  serial: string
  owner: string
  notes: string
  mgmtIp: string
  mgmtInterface: string
  templateId: string | null
  /** System template (built-in catalog) when the organization has none for the model (ADR-035). */
  catalogId?: string
  /** Problems found before sending (the server checks the rest). */
  problems: string[]
}

export interface ProposedCluster {
  key: string
  kind: 'ha_active_passive' | 'stack'
  name: string
  ip: string
  siteId: string
  /** Lines, first = primary (cannot be known from a file: to confirm). */
  lines: number[]
  accepted: boolean
}

const STACKABLE = /^(c9[23]00|c1300|ws-c3[68]50|ex[234]\d00|usw-pro)/i
const SWITCHES = new Set<DeviceType>(['l2_switch', 'l3_switch', 'poe_switch'])

/**
 * Rows with the same management IP, site and type (and the same model when known) are one HA pair / stack: the IP
 * goes to the cluster (VIP), not to each member (ADR-027). Firewalls / routers → HA; stack-capable switches → stack.
 */
export function proposeClusters(rows: PlannedRow[]): ProposedCluster[] {
  const groups = new Map<string, PlannedRow[]>()
  for (const r of rows) {
    if (!r.mgmtIp || !r.siteId || !r.type) continue
    const ip = r.mgmtIp.split('/')[0]!
    const k = `${ip}|${r.siteId}|${r.type}|${norm(r.model)}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const out: ProposedCluster[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const first = members[0]!
    const kind = SWITCHES.has(first.type!)
      ? STACKABLE.test(first.model)
        ? 'stack'
        : null
      : 'ha_active_passive'
    if (!kind) continue
    // A hostname saying "slave / secondary / backup" is not the primary.
    const sorted = [...members].sort(
      (a, b) =>
        Number(/slave|slaver|secondary|backup|standby/i.test(a.hostname)) -
        Number(/slave|slaver|secondary|backup|standby/i.test(b.hostname)),
    )
    out.push({
      key: `c${out.length + 1}`,
      kind,
      name: `${sorted[0]!.hostname}-${kind === 'stack' ? 'STACK' : 'HA'}`.slice(0, 100),
      ip: first.mgmtIp,
      siteId: first.siteId!,
      lines: sorted.map((r) => r.line),
      accepted: true,
    })
  }
  return out
}

/** Problems inside the file itself: repeated hostnames / serials, rows sharing an IP outside a cluster. */
export function fileProblems(
  rows: PlannedRow[],
  clusters: ProposedCluster[],
): Map<number, string[]> {
  const out = new Map<number, string[]>()
  const add = (line: number, msg: string) => out.set(line, [...(out.get(line) ?? []), msg])
  const inCluster = new Set(clusters.filter((c) => c.accepted).flatMap((c) => c.lines))
  const seen = (
    key: (r: PlannedRow) => string,
    msg: (first: PlannedRow) => string,
    skip?: (r: PlannedRow) => boolean,
  ) => {
    const first = new Map<string, PlannedRow>()
    for (const r of rows) {
      const k = key(r)
      if (!k || skip?.(r)) continue
      const f = first.get(k)
      if (f) add(r.line, msg(f))
      else first.set(k, r)
    }
  }
  seen(
    (r) => r.hostname.toLowerCase(),
    (f) => `Hostname trùng dòng ${f.line}`,
  )
  seen(
    (r) =>
      /^(-|n\/?a|none|unknown|tbd|0)?$/i.test(r.serial.trim()) ? '' : r.serial.trim().toLowerCase(),
    (f) => `S/N trùng dòng ${f.line}`,
  )
  seen(
    (r) => r.mgmtIp.split('/')[0]!,
    (f) => `IP trùng dòng ${f.line} (không cùng cụm)`,
    (r) => inCluster.has(r.line),
  )
  return out
}

/** What goes to the API for a planned row (credentials were never read into it). */
export function toImportRow(r: PlannedRow, cluster: ProposedCluster | undefined): ImportRow {
  const pos = cluster ? cluster.lines.indexOf(r.line) : -1
  return {
    row: r.line,
    device: {
      hostname: r.hostname,
      type: r.type ?? 'other',
      siteId: r.siteId ?? '',
      vendor: r.vendor || undefined,
      model: r.model || undefined,
      partNumber: r.partNumber || undefined,
      serialNumber: r.serial || undefined,
      ownerName: r.owner || undefined,
      notes: r.notes || undefined,
      templateId: r.templateId ?? undefined,
      ...(r.catalogId ? { catalogId: r.catalogId } : {}),
      ...(cluster
        ? {
            clusterRole: pos === 0 ? 'primary' : cluster.kind === 'stack' ? 'member' : 'secondary',
            clusterMemberNo: pos + 1,
          }
        : {}),
    },
    clusterKey: cluster?.key,
    mgmtIp: r.mgmtIp || undefined,
    mgmtInterface: r.mgmtInterface || undefined,
  }
}

export function toImportCluster(c: ProposedCluster, rows: PlannedRow[]): ImportCluster {
  const primary = rows.find((r) => r.line === c.lines[0])
  return {
    key: c.key,
    kind: c.kind,
    name: c.name,
    hostname: primary?.hostname,
    mgmtIp: c.ip,
    siteId: c.siteId,
  }
}

/** Value choices the user confirmed in the mapping step. */
export interface ValueMaps {
  /** Device kind text (normalized) → type. */
  types: Record<string, DeviceType>
  /** `${company}|${location}` (normalized) → site id. */
  sites: Record<string, string>
}

export const siteKeyOf = (company: string, location: string) => `${norm(company)}|${norm(location)}`

/** Spreadsheet rows → planned devices (credentials columns are skipped here and never stored). */
export function buildPlan<
  T extends { id: string; partNumber: string; model: string; type: string },
>(
  rows: { line: number; cells: string[] }[],
  mapping: Field[],
  meta: HeaderInfo['meta'],
  values: ValueMaps,
  templates: T[],
): PlannedRow[] {
  return rows.map(({ line, cells }) => {
    const raw: Partial<Record<Field, string>> = { ...meta }
    mapping.forEach((f, i) => {
      if (f !== 'ignore' && f !== 'secret' && cells[i]) raw[f] = cells[i]
    })
    const problems: string[] = []
    const product = inferProduct(raw.partNumber ?? raw.model ?? '')
    const vendor = raw.vendor ?? product.vendor
    const model = raw.model ?? product.model
    const partNumber = raw.partNumber ? product.partNumber : ''
    const type =
      values.types[norm(raw.type ?? '')] ?? typeFromText(raw.type ?? '', raw.partNumber ?? '')
    const siteId = values.sites[siteKeyOf(raw.category ?? '', raw.site ?? '')] ?? null
    const hostname = (raw.hostname ?? '').trim()
    if (!hostname) problems.push('Thiếu hostname')
    if (!type) problems.push(`Chưa biết loại thiết bị "${raw.type ?? ''}"`)
    if (!siteId) problems.push(`Chưa chọn site cho "${raw.site ?? ''}"`)
    const tpl = type
      ? matchTemplate(templates, { partNumber: raw.partNumber ?? '', model }, type)
      : undefined
    return {
      line,
      hostname,
      raw,
      type,
      siteId,
      vendor,
      model,
      partNumber,
      serial: raw.serial ?? '',
      owner: raw.owner ?? '',
      notes: raw.notes ?? '',
      mgmtIp: (raw.mgmtIp ?? '').trim(),
      mgmtInterface: raw.mgmtInterface ?? '',
      templateId: tpl?.id ?? null,
      problems,
    }
  })
}
