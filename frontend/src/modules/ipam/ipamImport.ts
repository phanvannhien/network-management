import type { components } from '@/api/client'
import { norm, type Sheet } from '@/modules/inventory/import/parse'

// IPAM import (P2-09, SRS §12): an IP plan spreadsheet → rows for POST /ipam-imports. Columns are recognised by their
// header (Vietnamese or English, any case / diacritics); a row may carry a VLAN, a subnet and a range. A "range" column
// holding "10.1.20.100 - 10.1.20.200" is split into start / end.

export type IpamImportRow = components['schemas']['IpamImportRow']
export type IpamImportResult = components['schemas']['IpamImportResult']

export type IpamField =
  | 'site'
  | 'vlan'
  | 'vlanName'
  | 'cidr'
  | 'mask'
  | 'gateway'
  | 'vrf'
  | 'description'
  | 'rangeStart'
  | 'rangeEnd'
  | 'range'
  | 'rangeKind'
  | 'purpose'

/** Header words per field, already normalised (lowercase, no diacritics, letters / digits only). */
const SYNONYMS: Record<IpamField, string[]> = {
  site: ['site', 'masite', 'chinhanh', 'diadiem', 'location', 'vanphong', 'office', 'branch'],
  vlan: ['vlan', 'vlanid', 'vid', 'sovlan', 'mavlan', 'vlanno'],
  vlanName: ['tenvlan', 'vlanname', 'namevlan', 'tenmang'],
  cidr: [
    'subnet',
    'cidr',
    'network',
    'mang',
    'daimang',
    'prefix',
    'subnetcidr',
    'networkaddress',
    'lopmang',
  ],
  mask: [
    'mask',
    'subnetmask',
    'netmask',
    'prefixlength',
    'prefixlen',
    'sobit',
    'bitmask',
    'subnetmasklength',
  ],
  gateway: ['gateway', 'gw', 'congmacdinh', 'defaultgateway'],
  vrf: ['vrf', 'vrfname'],
  description: ['mota', 'description', 'desc', 'ghichu', 'note', 'notes', 'chuthich'],
  rangeStart: [
    'tu',
    'start',
    'from',
    'ipdau',
    'daitu',
    'startip',
    'rangestart',
    'ipbatdau',
    'batdau',
    'firstip',
  ],
  rangeEnd: [
    'den',
    'end',
    'to',
    'ipcuoi',
    'daiden',
    'endip',
    'rangeend',
    'ipketthuc',
    'ketthuc',
    'lastip',
  ],
  range: ['dai', 'daiip', 'range', 'iprange', 'pool', 'dhcppool', 'khoangip'],
  rangeKind: ['loai', 'loaidai', 'type', 'kind', 'rangetype', 'kieu', 'loaiip'],
  purpose: ['mucdich', 'purpose', 'dungcho', 'sudung', 'usage', 'role'],
}

export const IPAM_FIELDS = Object.keys(SYNONYMS) as IpamField[]

export function fieldOf(header: string): IpamField | null {
  const h = norm(header)
  if (!h) return null
  for (const f of IPAM_FIELDS) if (SYNONYMS[f].includes(h)) return f
  return null
}

const CIDR_RE = /^\s*[0-9a-f:.]+\/\d{1,3}\s*$/i

/**
 * The header row (the first of the first rows that names a subnet / CIDR column) and the field of each column.
 * null when no column looks like a subnet.
 */
export function detectColumns(
  sheet: Sheet,
): { header: number; columns: (IpamField | null)[] } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 15); r++) {
    const cols = sheet.rows[r]!.map(fieldOf)
    if (cols.includes('cidr')) {
      // A field named twice keeps its first column.
      const seen = new Set<IpamField>()
      return {
        header: r,
        columns: cols.map((f) => {
          if (!f || seen.has(f)) return null
          seen.add(f)
          return f
        }),
      }
    }
  }
  return null
}

export interface ParsedRow {
  /** Spreadsheet row number (1-based, as Excel shows it). */
  line: number
  row: IpamImportRow
}

/** Data rows under the header, empty ones dropped. */
export function ipamRows(sheet: Sheet, header: number, columns: (IpamField | null)[]): ParsedRow[] {
  const out: ParsedRow[] = []
  for (let r = header + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r]!
    const v: Partial<Record<IpamField, string>> = {}
    columns.forEach((f, c) => {
      const cell = (cells[c] ?? '').trim()
      if (f && cell) v[f] = cell
    })
    if (Object.keys(v).length === 0) continue
    let start = v.rangeStart ?? ''
    let end = v.rangeEnd ?? ''
    if (v.range && !start && !end) {
      const [a, b] = v.range.split(/\s*(?:-|–|—|→|to|đến)\s*/i)
      start = a ?? ''
      end = b ?? ''
    }
    const cidr = withMask(v.cidr ?? '', v.mask ?? '')
    ;[start, end] = fullRange(start, end, cidr)
    // "VLAN 10", "10 - Data": the number, and the rest as its name when no name column says otherwise.
    const vm = (v.vlan ?? '').match(/^(?:vlan\s*)?(\d{1,4})(?:\s*[-–:]\s*(.+))?$/i)
    const vlan = vm ? Number(vm[1]) : null
    const row: IpamImportRow = {
      site: v.site ?? '',
      vlan,
      vlanName: v.vlanName ?? vm?.[2]?.trim() ?? '',
      cidr,
      gateway: v.gateway ?? '',
      vrf: v.vrf ?? '',
      description: v.description ?? '',
      rangeStart: start,
      rangeEnd: end,
      rangeKind: v.rangeKind ?? '',
      purpose: v.purpose ?? '',
    }
    if (!row.vlan && !row.cidr && !row.rangeStart && !row.rangeEnd) continue
    out.push({ line: r + 1, row })
  }
  return out
}

/** "10.1.20.0" + mask "255.255.255.0" (or "24", "/24") → "10.1.20.0/24"; a CIDR is kept as written. */
export function withMask(network: string, mask: string): string {
  const n = network.trim()
  if (!n || n.includes('/') || !mask.trim()) return n
  const m = mask.trim().replace(/^\//, '')
  if (/^\d{1,3}$/.test(m)) return `${n}/${m}`
  const parts = m.split('.').map(Number)
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return n
  const bits = parts.map((x) => x.toString(2).padStart(8, '0')).join('')
  // A valid mask is ones then zeros.
  return /^1*0*$/.test(bits) ? `${n}/${bits.indexOf('0') === -1 ? 32 : bits.indexOf('0')}` : n
}

/**
 * Short IPv4 ranges as plans write them: ".100" – ".200" (taken from the subnet), "10.1.20.100" – "200" (from the
 * start). Anything else is kept as written.
 */
export function fullRange(start: string, end: string, cidr: string): [string, string] {
  const prefixOf = (ip: string) => (ip.match(/^(\d+\.\d+\.\d+)\./) ?? [])[1]
  const base = prefixOf(cidr.split('/')[0] ?? '') ?? ''
  const short = (x: string) => /^\.?\d{1,3}$/.test(x)
  let a = start.trim()
  let b = end.trim()
  if (short(a) && base) a = `${base}.${a.replace(/^\./, '')}`
  const from = prefixOf(a) ?? base
  if (short(b) && from) b = `${from}.${b.replace(/^\./, '')}`
  return [a, b]
}

export function looksLikeCidr(v: string): boolean {
  return CIDR_RE.test(v)
}
