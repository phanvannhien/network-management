import type { components } from '@/api/client'

// The L2 view (P2-08, ADR-047): a lens over the physical layout, derived from the inventory only. Each cable is drawn
// by what its ports carry — one VLAN (access, coloured like the VLAN in IPAM), many VLANs (trunk), none (routed) or
// "not filled in" — and cables whose two ends disagree get a mark. Only two switchports are ever compared: the far
// end of a camera, an AP or a router port has nothing to compare with.

export type DiagramVlan = components['schemas']['DiagramVlan']
export type DiagramGateway = components['schemas']['DiagramGateway']
export type InterfaceMode = components['schemas']['InterfaceMode']

/** What the L2 view needs of one cable end's port (a LAG member already follows its LAG, server side). */
export interface PortL2 {
  mode: InterfaceMode
  access: number | null
  native: number | null
  /** e.g. "10,20,30-35"; '' = not filled in (vendors differ: all VLANs, VLAN 1 only or the native one only). */
  allowed: string
  lagId: string | null
  lagName: string
}

/** A VLAN list: every VLAN, or ranges [low, high] sorted and merged. */
export type VlanSet = 'all' | [number, number][]

/** Vendors send untagged frames on VLAN 1 unless told otherwise. */
export const DEFAULT_NATIVE = 1

export function parseVlanList(s: string): VlanSet {
  const t = s.replace(/\s+/g, '')
  if (t === '') return 'all'
  const ranges: [number, number][] = []
  for (const part of t.split(',')) {
    const [lo, hi = lo] = part.split('-').map(Number)
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) continue
    ranges.push(lo! <= hi! ? [lo!, hi!] : [hi!, lo!])
  }
  const merged = mergeRanges(ranges)
  // "1-4094" typed on purpose is every VLAN.
  return merged.length === 1 && merged[0]![0] <= 1 && merged[0]![1] >= 4094 ? 'all' : merged
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export function vlanSetHas(set: VlanSet, vid: number): boolean {
  return set === 'all' || set.some(([lo, hi]) => vid >= lo && vid <= hi)
}

/** "10,20,30–35" (en dash for ranges, like port ranges on the canvas). */
export function formatVlanSet(set: VlanSet): string {
  if (set === 'all') return 'ALL'
  return set
    .map(([lo, hi]) => (lo === hi ? `${lo}` : hi === lo + 1 ? `${lo},${hi}` : `${lo}–${hi}`))
    .join(',')
}

/** Every VLAN id of a set, up to `limit` (chips on a trunk). */
export function vlanIds(set: VlanSet, limit = 4094): number[] {
  if (set === 'all') return []
  const out: number[] = []
  for (const [lo, hi] of set) for (let v = lo; v <= hi && out.length < limit; v++) out.push(v)
  return out
}

export function countVlans(set: VlanSet): number {
  return set === 'all' ? 4094 : set.reduce((n, [lo, hi]) => n + hi - lo + 1, 0)
}

/** Members of `a` missing from `b` (both explicit lists). */
export function vlanSetMinus(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [lo, hi] of a) {
    let start = lo
    for (const [blo, bhi] of b) {
      if (bhi < start || blo > hi) continue
      if (blo > start) out.push([start, blo - 1])
      start = Math.max(start, bhi + 1)
      if (start > hi) break
    }
    if (start <= hi) out.push([start, hi])
  }
  return out
}

export interface VlanInfo {
  vid: number
  name: string
  color: string
  /** Which VLAN record: `<siteId>:<vid>`, `org:<vid>`, or `?:<vid>` when IPAM has none. Same number ≠ same VLAN. */
  key: string
  /** Not in IPAM (neither for the site nor organization-wide). */
  unknown?: boolean
}

const UNKNOWN_COLOR = '#a1a1aa'

/** VLAN name and colour as seen from a site: the site's own VLAN first, then the organization-wide one. */
export function vlanInfo(
  vid: number,
  siteId: string | undefined,
  vlans: readonly DiagramVlan[],
): VlanInfo {
  let org: DiagramVlan | undefined
  for (const v of vlans) {
    if (v.vid !== vid) continue
    if (siteId && v.siteId === siteId)
      return { vid, name: v.name, color: v.color, key: `${siteId}:${vid}` }
    if (!v.siteId) org = v
  }
  return org
    ? { vid, name: org.name, color: org.color, key: `org:${vid}` }
    : { vid, name: '', color: UNKNOWN_COLOR, key: `?:${vid}`, unknown: true }
}

export function vidOfKey(key: string): number {
  return Number(key.slice(key.lastIndexOf(':') + 1))
}

export type L2Kind = 'access' | 'trunk' | 'routed' | 'unset'

/** A mismatch between the two ends of one cable (i18n key + values); info = worth a look, not wrong. */
export interface L2Issue {
  key:
    | 'accessDiffers'
    | 'nativeDiffers'
    | 'nativeOneSide'
    | 'allowedOneSide'
    | 'accessToTrunk'
    | 'lagOneSide'
  level: 'warning' | 'info'
  values: Record<string, string | number>
}

/** What one switchport end lets through: tagged VLANs ('unknown' = list not filled in) and the untagged one. */
interface EndCarry {
  tagged: VlanSet | 'unknown'
  untagged: number | null
}

export interface L2Edge {
  kind: L2Kind
  /** hybrid ports are drawn as trunks but named so. */
  hybrid: boolean
  /** VLANs the cable carries: one for access, the allowed list for a trunk ('all' when not filled in). */
  vlans: VlanSet
  /** A trunk whose allowed list nobody filled in: what passes depends on the vendor ("ALL?"). */
  unspecified: boolean
  /** Untagged VLAN on a trunk when it is not the default one. */
  native: number | null
  /** An access port with no VLAN filled in. */
  noVlan: boolean
  issues: L2Issue[]
  /** Each switchport end, for "does this cable carry VLAN x". */
  ends: EndCarry[]
}

const SWITCHPORT: ReadonlySet<InterfaceMode> = new Set(['access', 'trunk', 'hybrid'])
const RANK: Record<InterfaceMode, number> = { trunk: 4, hybrid: 4, access: 3, routed: 2, '': 1 }

function endCarry(p: PortL2): EndCarry {
  if (p.mode === 'access') return { tagged: [], untagged: p.access }
  return {
    tagged: p.allowed.trim() === '' ? 'unknown' : parseVlanList(p.allowed),
    untagged: p.native ?? DEFAULT_NATIVE,
  }
}

/**
 * What one cable carries, from its two ends. The end with the "widest" mode decides how it is drawn (a trunk over an
 * access port over a routed one), since the other end is often a router, a camera or a box with nothing filled in.
 */
export function classifyL2(a: PortL2 | undefined, b: PortL2 | undefined): L2Edge {
  const known = [a, b].filter((p): p is PortL2 => Boolean(p && p.mode))
  const ends = known.filter((p) => SWITCHPORT.has(p.mode)).map(endCarry)
  const issues: L2Issue[] = []
  if (a && b && SWITCHPORT.has(a.mode) && SWITCHPORT.has(b.mode)) issues.push(...compare(a, b))
  if (a?.mode && b?.mode && Boolean(a.lagId) !== Boolean(b.lagId))
    issues.push({ key: 'lagOneSide', level: 'warning', values: { lag: a.lagName || b.lagName } })
  const base = {
    hybrid: false,
    vlans: [] as VlanSet,
    unspecified: false,
    native: null,
    noVlan: false,
    issues,
    ends,
  }
  if (known.length === 0) return { ...base, kind: 'unset' }
  const lead = known.reduce((x, y) => (RANK[y.mode] > RANK[x.mode] ? y : x))
  switch (lead.mode) {
    case 'access':
      return lead.access
        ? { ...base, kind: 'access', vlans: [[lead.access, lead.access]] }
        : { ...base, kind: 'access', noVlan: true }
    case 'trunk':
    case 'hybrid': {
      const native = lead.native ?? DEFAULT_NATIVE
      return {
        ...base,
        kind: 'trunk',
        hybrid: lead.mode === 'hybrid',
        vlans: parseVlanList(lead.allowed),
        unspecified: lead.allowed.trim() === '',
        native: native === DEFAULT_NATIVE ? null : native,
      }
    }
    case 'routed':
      return { ...base, kind: 'routed' }
    default:
      return { ...base, kind: 'unset' }
  }
}

function compare(a: PortL2, b: PortL2): L2Issue[] {
  const out: L2Issue[] = []
  if (a.mode === 'access' && b.mode === 'access') {
    if (a.access && b.access && a.access !== b.access)
      out.push({ key: 'accessDiffers', level: 'warning', values: { a: a.access, b: b.access } })
    return out
  }
  if (a.mode === 'access' || b.mode === 'access') {
    // An access port facing a trunk only works for the trunk's untagged (native) VLAN.
    const acc = a.mode === 'access' ? a : b
    const tr = a.mode === 'access' ? b : a
    const native = tr.native ?? DEFAULT_NATIVE
    if (acc.access && acc.access !== native)
      out.push({ key: 'accessToTrunk', level: 'warning', values: { access: acc.access, native } })
    return out
  }
  const na = a.native ?? DEFAULT_NATIVE
  const nb = b.native ?? DEFAULT_NATIVE
  if (na !== nb)
    out.push(
      // One side simply not filled in may just be the default there: worth a look, not wrong yet.
      a.native === null || b.native === null
        ? { key: 'nativeOneSide', level: 'info', values: { a: na, b: nb } }
        : { key: 'nativeDiffers', level: 'warning', values: { a: na, b: nb } },
    )
  // An empty list means different things per vendor: only two filled-in lists are compared.
  if (a.allowed.trim() !== '' && b.allowed.trim() !== '') {
    const la = parseVlanList(a.allowed)
    const lb = parseVlanList(b.allowed)
    if (la !== 'all' && lb !== 'all') {
      const only = mergeRanges([...vlanSetMinus(la, lb), ...vlanSetMinus(lb, la)])
      if (only.length > 0)
        out.push({ key: 'allowedOneSide', level: 'info', values: { vlans: formatVlanSet(only) } })
    } else if (la !== lb) {
      const list = la === 'all' ? lb : la
      if (list !== 'all')
        out.push({
          key: 'allowedOneSide',
          level: 'info',
          values: { vlans: `≠ ${formatVlanSet(list)}` },
        })
    }
  }
  return out
}

export type Carry = 'yes' | 'maybe' | 'no'

function endCarries(e: EndCarry, vid: number): Carry {
  if (e.untagged === vid) return 'yes'
  if (e.tagged === 'unknown') return 'maybe'
  return vlanSetHas(e.tagged, vid) ? 'yes' : 'no'
}

/**
 * Does the cable carry this VLAN (filter)? Only if every switchport end lets it through; "maybe" when one end does
 * not say (allowed list not filled in) or only one end lets it through. Routed / unset cables carry none.
 */
export function carries(e: L2Edge, vid: number): Carry {
  if (e.ends.length === 0) return 'no'
  const each = e.ends.map((x) => endCarries(x, vid))
  if (each.every((c) => c === 'yes')) return 'yes'
  if (each.every((c) => c === 'no')) return 'no'
  return 'maybe'
}

/**
 * VLAN ids a cable names explicitly (legend), from its switchport ends: access VLANs (both, when they differ), trunk
 * lists and a native VLAN other than the default.
 */
export function namedVids(e: L2Edge): number[] {
  const out = new Set<number>()
  for (const end of e.ends) {
    const access = Array.isArray(end.tagged) && end.tagged.length === 0
    if (end.untagged !== null && (access || end.untagged !== DEFAULT_NATIVE)) out.add(end.untagged)
    if (Array.isArray(end.tagged)) for (const v of vlanIds(end.tagged, 512)) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

// Cards are shared between document versions (Immer): an unchanged cable keeps its facts object, so React Flow sees an
// unchanged edge and does not re-render it (CLAUDE.md: changing one thing must not re-render the canvas).
const cache = new WeakMap<object, L2Edge>()

/** classifyL2 of a cable card, cached per card object. */
export function l2Of(card: { aL2?: PortL2; bL2?: PortL2 }): L2Edge {
  let e = cache.get(card)
  if (!e) {
    e = classifyL2(card.aL2, card.bL2)
    cache.set(card, e)
  }
  return e
}

const merged = new WeakMap<object, { cards: object[]; value: L2Edge }>()

/**
 * One line for several cables (a LAG on the L2 view): drawn like the first member, with every member's ends and
 * mismatches. Cached on the first card while the members stay the same objects.
 */
export function mergedL2(cards: { aL2?: PortL2; bL2?: PortL2 }[]): L2Edge {
  const first = cards[0]!
  const hit = merged.get(first)
  if (hit && hit.cards.length === cards.length && hit.cards.every((c, i) => c === cards[i]))
    return hit.value
  const all = cards.map(l2Of)
  const seen = new Set<string>()
  const issues = all
    .flatMap((e) => e.issues)
    .filter((i) => {
      const k = `${i.key}|${JSON.stringify(i.values)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  const value: L2Edge = { ...all[0]!, issues, ends: all.flatMap((e) => e.ends) }
  merged.set(first, { cards: [...cards], value })
  return value
}
