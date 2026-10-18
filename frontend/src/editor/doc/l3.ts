import ipaddr from 'ipaddr.js'
import type { DiagramNode, DocState } from './types'
import { firstPageId, pagesOf } from './pages'

// L3 pages (P2-08, ADR-047): routers, firewalls and L3 switches with the subnets they sit in, all from IPAM. A subnet is
// a bar; a device's interface IP in it is a line down to the bar ("vlan20 .1", GW for the subnet gateway); a transit
// /30 or /31 between two routers is a direct line, not a bar (the usual L3 drawing convention). Only positions are
// kept; what is attached is derived each time.

/** Device types that route (drawn on a generated L3 page). */
export const ROUTING_TYPES: ReadonlySet<string> = new Set([
  'provider_cloud',
  'firewall',
  'router',
  'vpn_gateway',
  'sdwan_edge',
  'l3_switch',
  'load_balancer',
])

const TYPE_ORDER: Record<string, number> = {
  provider_cloud: 0,
  firewall: 1,
  router: 2,
  sdwan_edge: 3,
  vpn_gateway: 3,
  load_balancer: 4,
  l3_switch: 5,
}

export const SUBNET_W = 420
/** Room between routers in the row: a /30 line between two of them has its subnet and both host parts written on it. */
const DEVICE_STEP = 340
export const SUBNET_H = 30

/** A transit link subnet (/30, /31; /127 for IPv6): drawn as a line between its two routers. */
export function isTransit(cidr: string): boolean {
  try {
    const [addr, len] = ipaddr.parseCIDR(cidr)
    return addr.kind() === 'ipv4' ? len >= 30 : len >= 127
  } catch {
    return false
  }
}

/** A subnet of public (Internet) addresses: an ISP hand-off, drawn on the WAN side. */
export function isPublic(cidr: string): boolean {
  try {
    const [addr] = ipaddr.parseCIDR(cidr)
    return addr.range() === 'unicast'
  } catch {
    return false
  }
}

/** ".1" for 10.1.20.1 in a /24, "::1" for IPv6: the host part, as written next to the line. */
export function hostPart(address: string): string {
  const ip = address.split('/')[0] ?? address
  if (ip.includes(':')) return `:${ip.split(':').at(-1)}`
  return `.${ip.split('.').at(-1)}`
}

export interface PlacedNode {
  refKind: 'device' | 'endpoint_group' | 'subnet'
  refId: string
  x: number
  y: number
  width?: number
}

/**
 * What an L3 page shows, laid out: the routing devices of the diagram's other pages in a row, the subnets they sit in
 * as bars (WAN above, LANs below), endpoint groups under their subnet. With `existing` (an L3 page already there), only
 * what is missing is placed — after what is there, keeping the user's layout.
 */
export function planL3(doc: DocState, existing: DiagramNode[] = []): PlacedNode[] {
  const l3 = doc.l3
  if (!l3) return []
  const first = firstPageId(doc.view)
  const l3Pages = new Set(
    pagesOf(doc.view, '')
      .filter((p) => p.layer === 'l3')
      .map((p) => p.id),
  )
  const sources = doc.view.nodes.filter((n) => !l3Pages.has(n.pageId || first))
  const have = new Set(existing.map((n) => `${n.refKind}|${n.refId}`))
  const gatewayOf = new Set(l3.attachments.filter((a) => a.isGateway).map((a) => a.deviceId))
  const devices = [
    ...new Set(
      sources
        .filter((n) => n.refKind === 'device')
        .map((n) => n.refId)
        .filter((id) => {
          const d = doc.devices[id]
          return d && (ROUTING_TYPES.has(d.type) || gatewayOf.has(id))
        }),
    ),
  ].sort((a, b) => {
    const da = doc.devices[a]!
    const db = doc.devices[b]!
    return (
      (TYPE_ORDER[da.type] ?? 9) - (TYPE_ORDER[db.type] ?? 9) ||
      da.hostname.localeCompare(db.hostname)
    )
  })
  const out: PlacedNode[] = []
  const xOf = new Map<string, number>()
  for (const n of existing) if (n.refKind === 'device') xOf.set(n.refId, n.x)
  let nextX =
    existing.length > 0 ? Math.max(...existing.map((n) => n.x + (n.width ?? 144))) + 96 : 0
  const rowY = existing.find((n) => n.refKind === 'device')?.y ?? 0
  for (const id of devices) {
    if (have.has(`device|${id}`)) continue
    xOf.set(id, nextX)
    out.push({ refKind: 'device', refId: id, x: nextX, y: rowY })
    nextX += DEVICE_STEP
  }
  // Subnets of those devices (transit /30 drawn as lines instead), most attached first.
  const attached = new Map<string, Set<string>>()
  for (const a of l3.attachments) {
    if (!a.subnetId || !xOf.has(a.deviceId)) continue
    const sn = l3.subnets[a.subnetId]
    if (!sn || isTransit(sn.cidr)) continue
    const set = attached.get(a.subnetId) ?? new Set<string>()
    set.add(a.deviceId)
    attached.set(a.subnetId, set)
  }
  // WAN goes above: a subnet of public addresses, or one the provider cloud sits in.
  const wan = (id: string) =>
    isPublic(l3.subnets[id]!.cidr) ||
    [...(attached.get(id) ?? [])].some((d) => doc.devices[d]?.type === 'provider_cloud')
  const subnets = [...attached.keys()].sort(
    (a, b) =>
      attached.get(b)!.size - attached.get(a)!.size ||
      l3.subnets[a]!.cidr.localeCompare(l3.subnets[b]!.cidr),
  )
  const bars = existing.filter((n) => n.refKind === 'subnet')
  let below = Math.max(rowY + 180, ...bars.filter((b) => b.y > rowY).map((b) => b.y + 90))
  let above = Math.min(rowY - 140, ...bars.filter((b) => b.y < rowY).map((b) => b.y - 90))
  const barX = new Map<string, number>()
  for (const b of bars) barX.set(b.refId, b.x)
  for (const id of subnets) {
    if (have.has(`subnet|${id}`)) continue
    const xs = [...attached.get(id)!].map((d) => xOf.get(d)!)
    const x = Math.min(...xs) - 40
    const width = Math.max(SUBNET_W, Math.max(...xs) - Math.min(...xs) + 144 + 80)
    const y = wan(id) ? above : below
    if (wan(id)) above -= 90
    else below += 90
    barX.set(id, x)
    out.push({ refKind: 'subnet', refId: id, x, y, width })
  }
  // Endpoint groups under their subnet bar.
  const groupY = below + 60
  const perSubnet = new Map<string, number>()
  for (const g of [
    ...new Set(sources.filter((n) => n.refKind === 'endpoint_group').map((n) => n.refId)),
  ]) {
    const sn = l3.groupSubnet[g]
    if (!sn || !barX.has(sn) || have.has(`endpoint_group|${g}`)) continue
    const i = perSubnet.get(sn) ?? 0
    perSubnet.set(sn, i + 1)
    out.push({ refKind: 'endpoint_group', refId: g, x: barX.get(sn)! + i * 180, y: groupY })
  }
  return out
}
