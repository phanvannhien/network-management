import type { components } from '@/api/client'
import { sharesPort, type LinkKind } from '@/modules/inventory/links'
import type { DocState } from '../doc/types'

// Wiring helpers (P1-17): the cable kind a pair of ends suggests, ports in the order engineers read them, and which
// ports are already taken — by saved cables and by the cables drawn in this editor but not saved yet.

type Link = components['schemas']['Link']

const SFP = ['SFP', 'SFP+', 'SFP28', 'QSFP']

/** A sensible first choice; the user can always change it. */
export function suggestKind(
  aType: string,
  bType: string,
  aMedia = '',
  bMedia = '',
  sameCluster = false,
): LinkKind {
  const types = [aType, bType]
  const power = (t: string) => t === 'ups' || t === 'pdu'
  if (power(aType) || power(bType)) {
    // A UPS / PDU network card (its RJ45 port) is an ordinary cable; otherwise it is a power cord.
    const cardPort = (power(aType) && aMedia === 'RJ45') || (power(bType) && bMedia === 'RJ45')
    return cardPort ? 'ethernet' : 'power'
  }
  if (types.includes('provider_cloud')) {
    if (types.includes('modem')) return 'dsl'
    return types.includes('ont') ? 'fiber' : 'ethernet'
  }
  if (aType === 'wireless_bridge' && bType === 'wireless_bridge') return 'wireless'
  // An AP serves its clients by radio (an endpoint group has no type).
  if (types.includes('access_point') && types.includes('')) return 'wireless'
  if (types.includes('olt') && (types.includes('ont') || types.includes(''))) return 'fiber'
  if (types.includes('console_server')) return 'console'
  const media = [aMedia, bMedia]
  if (media.includes('Radio')) return 'wireless'
  if (media.includes('Console')) return 'console'
  if (media.includes('Serial')) return 'serial'
  if (media.includes('PON')) return 'fiber'
  if (media.includes('xDSL')) return 'dsl'
  if (media.includes('Cellular')) return 'cellular'
  if (sameCluster) return 'stack'
  // SFP on both ends is usually fibre (a DAC is chosen by hand: Ethernet).
  if (SFP.includes(aMedia) && SFP.includes(bMedia)) return 'fiber'
  return 'ethernet'
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Physical ports first, then virtual ones; Gi1/0/2 before Gi1/0/10. */
export function sortPorts<T extends { name: string; kind: string }>(ports: T[]): T[] {
  return [...ports].sort(
    (a, b) =>
      Number(a.kind !== 'physical') - Number(b.kind !== 'physical') ||
      collator.compare(a.name, b.name),
  )
}

/**
 * Ports of `deviceId` occupied by a cable, with who is on the other end: saved cables (minus those deleted or moved
 * in this editor) plus the cables drawn here. `self` is the cable being edited.
 */
export function takenPorts(
  doc: DocState,
  deviceId: string,
  saved: Link[],
  self?: string,
): Map<string, string> {
  const out = new Map<string, string>()
  const host = (id: string, fallback = '') => doc.devices[id]?.hostname ?? fallback
  const mark = (kind: LinkKind, iface: string | null | undefined, far: string) => {
    if (iface && !sharesPort(kind)) out.set(iface, far)
  }
  for (const l of saved) {
    if (l.id === self || doc.deletedLinks.includes(l.id) || doc.linkEdits[l.id]) continue
    if (l.a.id === deviceId) mark(l.kind, l.a.interfaceId, l.b.name)
    if (l.b.id === deviceId) mark(l.kind, l.b.interfaceId, l.a.name)
  }
  const pending = [...Object.entries(doc.newLinks), ...Object.entries(doc.linkEdits)] as [
    string,
    components['schemas']['LinkInput'],
  ][]
  for (const [id, l] of pending) {
    if (id === self) continue
    if (l.a.id === deviceId) mark(l.kind, l.a.interfaceId, host(l.b.id, l.b.id))
    if (l.b.id === deviceId) mark(l.kind, l.b.interfaceId, host(l.a.id, l.a.id))
  }
  return out
}

const LONG_NAMES: [RegExp, string][] = [
  [/^HundredGigE/i, 'Hu'],
  [/^FortyGigabitEthernet/i, 'Fo'],
  [/^TwentyFiveGigE/i, 'Twe'],
  [/^TenGigabitEthernet/i, 'Te'],
  [/^GigabitEthernet/i, 'Gi'],
  [/^FastEthernet/i, 'Fa'],
  [/^Port-channel/i, 'Po'],
  [/^Ethernet(?=\d)/i, 'Eth'],
]

/** Short port name for cable-end labels (GigabitEthernet1/0/1 → Gi1/0/1); wan1, port1… stay as they are. */
export function shortPort(name: string): string {
  for (const [re, short] of LONG_NAMES) if (re.test(name)) return name.replace(re, short)
  return name
}

/**
 * Port names as ranges: ["Gi1/0/1", "Gi1/0/2", "Gi1/0/3", "Gi1/0/7"] → "Gi1/0/1–3, Gi1/0/7" (ADR-036: the cables of an
 * endpoint group drawn as one edge). Names that do not end in a number are listed as they are.
 */
export function portRanges(names: string[]): string {
  const parsed = names
    .map((name) => {
      const m = /^(.*?)(\d+)$/.exec(name)
      return m ? { prefix: m[1]!, n: Number(m[2]), name } : { prefix: name, n: NaN, name }
    })
    .sort((a, b) => a.prefix.localeCompare(b.prefix) || a.n - b.n)
  const out: string[] = []
  for (let i = 0; i < parsed.length;) {
    const first = parsed[i]!
    let j = i
    while (
      j + 1 < parsed.length &&
      !Number.isNaN(first.n) &&
      parsed[j + 1]!.prefix === first.prefix &&
      parsed[j + 1]!.n === parsed[j]!.n + 1
    )
      j++
    out.push(j > i ? `${first.name}–${parsed[j]!.n}` : first.name)
    i = j + 1
  }
  return out.join(', ')
}
