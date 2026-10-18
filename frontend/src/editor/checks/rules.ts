import ipaddr from 'ipaddr.js'
import type { DocState } from '../doc/types'
import type { Problem, Severity, ValidationContext } from './types'
import { pageOf } from '../doc/pages'
import { classifyL2, parseVlanList, vlanSetHas, type PortL2 } from '../l2/l2'

// Diagram checks (P1-20, SRS §7 Phase 1 + PLAN extras). Pure functions over a plain input (built from the document and
// the server's validation context) so they run in a Web Worker and in tests alike. Inventory errors created elsewhere
// (a duplicate IP…) are shown, not blocking: the writes that would create them are refused by the API already.

export interface CheckLink {
  id: string
  kind: string
  aKind: string
  aId: string
  aIface: string | null
  bKind: string
  bId: string
  bIface: string | null
}

export interface CheckIface {
  id: string
  deviceId: string
  name: string
  kind: string
  media: string
  speed: string
  mode: string
  accessVlan: number | null
  nativeVlan: number | null
  allowedVlans: string
  lagId: string | null
  /** auto, full or half (P2-10); absent on ports drawn in this editor. */
  duplex?: string
}

export interface CheckInput {
  nodes: { id: string; refKind: string; refId: string; x: number; y: number; page?: string }[]
  devices: Record<
    string,
    {
      hostname: string
      type: string
      siteId: string
      draft: boolean
      clusterKind: string
      lifecycle: string
      eosDate: string
    }
  >
  /** Today, YYYY-MM-DD (local), for date rules; given by the caller so the worker stays pure. */
  today: string
  frames: {
    /** Page of the frame (P2-08): a frame holds the devices drawn on its own page. */
    page?: string
    siteId: string
    locationId: string | null
    x: number
    y: number
    w: number
    h: number
  }[]
  /** Cable id → edge id on the view. */
  edgeOf: Record<string, string>
  links: CheckLink[]
  ifaces: CheckIface[]
  ctx: ValidationContext
}

const NODE_W = 144
const NODE_H = 80

/** The plain input of the checks: the server context with the editor's unsaved changes applied. */
export function buildCheckInput(
  doc: DocState,
  ctx: ValidationContext,
  today = new Date().toLocaleDateString('sv-SE'),
): CheckInput {
  const deleted = new Set(doc.deletedLinks)
  const goneDevices = new Set(doc.deletedDevices)
  const links = new Map<string, CheckLink>()
  for (const l of ctx.links) {
    if (deleted.has(l.id) || goneDevices.has(l.aId) || goneDevices.has(l.bId)) continue
    links.set(l.id, {
      id: l.id,
      kind: l.kind,
      aKind: l.aKind,
      aId: l.aId,
      aIface: l.aInterfaceId,
      bKind: l.bKind,
      bId: l.bId,
      bIface: l.bInterfaceId,
    })
  }
  const pending = [...Object.entries(doc.linkEdits), ...Object.entries(doc.newLinks)]
  for (const [id, l] of pending)
    links.set(id, {
      id,
      kind: l.kind,
      aKind: l.a.kind,
      aId: l.a.id,
      aIface: l.a.interfaceId ?? null,
      bKind: l.b.kind,
      bId: l.b.id,
      bIface: l.b.interfaceId ?? null,
    })
  const ifaces: CheckIface[] = ctx.interfaces.map((i) => ({ ...i }))
  for (const [deviceId, ports] of Object.entries(doc.newPorts ?? {}))
    for (const p of ports)
      ifaces.push({
        id: p.id,
        deviceId,
        name: p.name,
        kind: 'physical',
        media: p.media,
        speed: p.speed,
        mode: '',
        accessVlan: null,
        nativeVlan: null,
        allowedVlans: '',
        lagId: null,
      })
  const devices: CheckInput['devices'] = {}
  for (const [id, d] of Object.entries(doc.devices))
    devices[id] = {
      hostname: d.hostname,
      type: d.type,
      siteId: d.siteId,
      draft: d.draft === true,
      clusterKind: d.clusterKind ?? '',
      lifecycle: d.lifecycle ?? '',
      eosDate: d.eosDate ?? '',
    }
  return {
    nodes: doc.view.nodes.map((n) => ({
      id: n.id,
      refKind: n.refKind,
      refId: n.refId,
      x: n.x,
      y: n.y,
      page: pageOf(doc.view, n),
    })),
    devices,
    today,
    frames: doc.view.annotations
      .filter((a) => a.kind === 'zone' && a.siteId)
      .map((a) => ({
        page: pageOf(doc.view, a),
        siteId: a.siteId!,
        locationId: a.locationId ?? null,
        x: a.x,
        y: a.y,
        w: a.width ?? 0,
        h: a.height ?? 0,
      })),
    edgeOf: Object.fromEntries(doc.view.edges.map((e) => [e.linkId, e.id])),
    links: [...links.values()],
    ifaces,
    ctx,
  }
}

const SHARED = new Set(['logical', 'wireless', 'cellular'])
/** Endpoint device kinds (their addresses are often DHCP reservations). */
const ENDPOINT_TYPES = new Set([
  'pc',
  'laptop',
  'printer',
  'ip_camera',
  'ip_phone',
  'iot',
  'access_control',
  'video_conference',
  'nvr',
  'server',
  'nas',
])
const SFP = new Set(['SFP', 'SFP+', 'SFP28', 'QSFP'])

const inRange = (ip: string, start: string, end: string) => {
  try {
    const a = ipaddr.parse(ip).toByteArray()
    const s = ipaddr.parse(start).toByteArray()
    const e = ipaddr.parse(end).toByteArray()
    if (a.length !== s.length) return true
    const cmp = (x: number[], y: number[]) => {
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
      return 0
    }
    return cmp(a, s) >= 0 && cmp(a, e) <= 0
  } catch {
    return true
  }
}

/** Why an address cannot be a configured host address, if it cannot. */
export function badHostAddress(address: string): string | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6
  try {
    addr = ipaddr.parseCIDR(address)[0]
  } catch {
    try {
      addr = ipaddr.parse(address)
    } catch {
      return 'format'
    }
  }
  const range = addr.range()
  if (
    range === 'unspecified' ||
    range === 'multicast' ||
    range === 'loopback' ||
    range === 'broadcast'
  )
    return range
  if (addr.kind() === 'ipv4' && range === 'linkLocal') return 'linkLocal'
  return null
}

/**
 * Network / broadcast address of an IPv4 subnet (not for /31, /32). A bare address (stored as /32) is placed in the
 * longest IPAM subnet of its VRF that contains it.
 */
export function edgeAddress(
  address: string,
  vrf: string,
  subnets: ValidationContext['subnets'],
): { which: 'network' | 'broadcast'; cidr: string } | null {
  try {
    const [addr, len] = ipaddr.parseCIDR(address)
    if (addr.kind() !== 'ipv4') return null
    let cidr = address
    if (len === 32) {
      const best = subnets
        .filter((sn) => sn.vrf === vrf)
        .map((sn) => ({ sn, p: ipaddr.parseCIDR(sn.cidr) }))
        .filter(({ p }) => p[0].kind() === 'ipv4' && addr.match(p))
        .sort((x, y) => y.p[1] - x.p[1])[0]
      if (!best) return null
      cidr = `${addr.toString()}/${best.p[1]}`
    }
    const l = Number(cidr.split('/')[1])
    if (l >= 31) return null
    const host = addr.toString()
    const network = ipaddr.IPv4.networkAddressFromCIDR(cidr).toString()
    const subnet = `${network}/${l}`
    if (host === network) return { which: 'network', cidr: subnet }
    if (host === ipaddr.IPv4.broadcastAddressFromCIDR(cidr).toString())
      return { which: 'broadcast', cidr: subnet }
  } catch {
    // reported as a format problem
  }
  return null
}

/**
 * The IPAM gateway of the address's subnet when the address's own mask leaves it out (SRS §7 "gateway sai subnet",
 * ADR-038 talk 2026-10-17): the subnet is a /23 with gateway .1 but the device was given a /24 that cannot reach it —
 * usually a mistyped mask. Host routes (/32, /128) and the gateway itself are not checked.
 */
/**
 * The DHCP pool of the most specific subnet (same VRF) an interface IP sits in, if it sits in one (P2-09): a static
 * address there may be handed to another machine by the DHCP server. `gateway` = the IP is the subnet's gateway.
 */
/** inRange that says no when an address cannot be read or the families differ (inRange says yes, to stay quiet). */
function inRangeStrict(ip: string, start: string, end: string): boolean {
  try {
    const a = ipaddr.parse(ip)
    const s = ipaddr.parse(start)
    const e = ipaddr.parse(end)
    if (a.kind() !== s.kind() || a.kind() !== e.kind()) return false
  } catch {
    return false
  }
  return inRange(ip, start, end)
}

export function dhcpPoolOf(
  address: string,
  vrf: string,
  subnets: ValidationContext['subnets'],
): { start: string; end: string; cidr: string; gateway: boolean } | null {
  try {
    const [addr] = ipaddr.parseCIDR(
      address.includes('/') ? address : `${address}/${address.includes(':') ? 128 : 32}`,
    )
    const best = subnets
      .filter((sn) => sn.vrf === vrf)
      .map((sn) => ({ sn, p: ipaddr.parseCIDR(sn.cidr) }))
      .filter(({ p }) => p[0].kind() === addr.kind() && addr.match(p))
      .sort((x, y) => y.p[1] - x.p[1])[0]
    if (!best) return null
    const host = addr.toString()
    const pool = (best.sn.dhcp ?? []).find((r) => inRangeStrict(host, r.start, r.end))
    if (!pool) return null
    return {
      start: pool.start,
      end: pool.end,
      cidr: best.sn.cidr,
      gateway: best.sn.gateway === host,
    }
  } catch {
    return null
  }
}

export function gatewayOutsideMask(
  address: string,
  vrf: string,
  subnets: ValidationContext['subnets'],
): { gateway: string; cidr: string } | null {
  try {
    const [addr, len] = ipaddr.parseCIDR(address)
    if (len === (addr.kind() === 'ipv4' ? 32 : 128)) return null
    const best = subnets
      .filter((sn) => sn.vrf === vrf && sn.gateway)
      .map((sn) => ({ sn, p: ipaddr.parseCIDR(sn.cidr) }))
      .filter(({ p }) => p[0].kind() === addr.kind() && addr.match(p))
      .sort((x, y) => y.p[1] - x.p[1])[0]
    if (!best) return null
    const gw = ipaddr.parse(best.sn.gateway)
    if (gw.kind() !== addr.kind() || gw.toString() === addr.toString()) return null
    return gw.match(addr, len) ? null : { gateway: gw.toString(), cidr: best.sn.cidr }
  } catch {
    return null // reported as a format problem
  }
}

/** "1G", "1000M", "1 Gbps", "10GE", "100" → Mbps; unknown → 0. */
export function speedMbps(speed?: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)/i.exec(speed ?? '')
  if (!m) return 0
  const unit = m[2]!.toLowerCase()
  const mult = unit === 'k' ? 0.001 : unit === 'g' ? 1000 : unit === 't' ? 1_000_000 : 1
  return Number(m[1]) * mult
}

const family = (a: string) => (a.includes(':') ? 6 : 4)
/** A host route (/32, /128: unnumbered, loopback-style) says nothing about the link's subnet. */
const hostRoute = (a: string) => {
  const len = Number(a.split('/')[1] ?? (family(a) === 4 ? 32 : 128))
  return len === (family(a) === 4 ? 32 : 128)
}
const sameNetwork = (a: string, b: string) => {
  try {
    const [ia, la] = ipaddr.parseCIDR(a)
    const ib = ipaddr.parse(b.split('/')[0]!)
    return ia.kind() === ib.kind() && ib.match(ia, la)
  } catch {
    return true
  }
}

export function runChecks(input: CheckInput): Problem[] {
  const out: Problem[] = []
  const nodeOf = new Map<string, string>()
  for (const n of input.nodes) if (!nodeOf.has(n.refId)) nodeOf.set(n.refId, n.id)
  const ifById = new Map(input.ifaces.map((i) => [i.id, i]))
  const ctxDevice = new Map(input.ctx.devices.map((d) => [d.id, d]))
  const host = (id: string) =>
    input.devices[id]?.hostname ??
    ctxDevice.get(id)?.hostname ??
    input.ctx.groups.find((g) => g.id === id)?.name ??
    '?'
  const push = (
    rule: string,
    severity: Severity,
    target: Problem['target'] | null,
    params: Problem['params'],
    key: string,
  ) => {
    if (target) out.push({ key: `${rule}:${key}`, rule, severity, params, target })
  }
  const deviceTarget = (id: string): Problem['target'] | null => {
    const n = nodeOf.get(id)
    return n ? { kind: 'node', id: n } : null
  }
  const linkTarget = (l: CheckLink): Problem['target'] | null => {
    const e = input.edgeOf[l.id]
    if (e) return { kind: 'edge', id: e }
    return deviceTarget(l.aId) ?? deviceTarget(l.bId)
  }

  // Org-wide conflicts computed by the server: duplicate IP / hostname / serial (Error).
  for (const c of input.ctx.conflicts)
    push(
      `duplicate-${c.kind}`,
      c.severity,
      deviceTarget(c.deviceId),
      { host: host(c.deviceId), value: c.value, other: c.other, otherIface: c.otherInterface },
      `${c.deviceId}:${c.value}:${c.other}`,
    )

  // A device in use whose vendor support has ended (SRS §7, P2-22): no more security fixes — plan its replacement.
  for (const n of input.nodes) {
    const d = input.devices[n.refId]
    if (d && d.lifecycle === 'active' && d.eosDate && d.eosDate < input.today)
      push(
        'end-of-support',
        'warning',
        { kind: 'node', id: n.id },
        { host: d.hostname, date: d.eosDate },
        n.refId,
      )
  }

  // Pending devices: a hostname already on this diagram.
  const names = new Map<string, string>()
  for (const n of input.nodes) {
    const d = input.devices[n.refId]
    if (!d || d.type === 'provider_cloud') continue
    const k = d.hostname.toLowerCase()
    const first = names.get(k)
    // The same device drawn twice is not a duplicate of itself.
    if (first && first !== n.refId && (d.draft || input.devices[first]?.draft))
      push(
        'duplicate-hostname',
        'error',
        deviceTarget(n.refId),
        { host: d.hostname, value: d.hostname, other: d.hostname, otherIface: '' },
        n.refId,
      )
    else names.set(k, n.refId)
  }

  // IPs: not a host address at all (Error); network / broadcast address of its subnet (Warning, PLAN 2026-10-16:
  // usually the mask is what is wrong).
  for (const ip of input.ctx.ips) {
    if (ip.role !== 'primary' && ip.role !== 'secondary') continue
    const bad = badHostAddress(ip.address)
    if (bad) {
      push(
        'ip-format',
        'error',
        deviceTarget(ip.deviceId),
        { host: host(ip.deviceId), ip: ip.address, why: bad },
        `${ip.deviceId}:${ip.address}`,
      )
      continue
    }
    // Loopbacks / tunnels carved out of a pool (10.255.255.0/32 in a /24) are not hosts of that subnet.
    const kind = ip.interfaceId ? ifById.get(ip.interfaceId)?.kind : undefined
    const edge =
      kind === 'loopback' || kind === 'tunnel'
        ? null
        : edgeAddress(ip.address, ip.vrf, input.ctx.subnets)
    const gw =
      kind === 'loopback' || kind === 'tunnel'
        ? null
        : gatewayOutsideMask(ip.address, ip.vrf, input.ctx.subnets)
    // A static address inside a DHCP pool (P2-09); the subnet's own gateway there is the classic SMB mistake.
    const pool =
      kind === 'loopback' || kind === 'tunnel'
        ? null
        : dhcpPoolOf(ip.address, ip.vrf, input.ctx.subnets)
    // An endpoint's address inside the pool is often a DHCP reservation: a note; a network device's is a warning.
    const endpoint = ENDPOINT_TYPES.has(ctxDevice.get(ip.deviceId)?.type ?? '')
    if (pool)
      push(
        pool.gateway ? 'gateway-in-dhcp' : 'static-in-dhcp',
        pool.gateway || !endpoint ? 'warning' : 'info',
        deviceTarget(ip.deviceId),
        {
          host: host(ip.deviceId),
          ip: ip.address,
          start: pool.start,
          end: pool.end,
          cidr: pool.cidr,
        },
        `${ip.deviceId}:${ip.address}`,
      )
    if (gw)
      push(
        'gateway-mask',
        'warning',
        deviceTarget(ip.deviceId),
        { host: host(ip.deviceId), ip: ip.address, gateway: gw.gateway, cidr: gw.cidr },
        `${ip.deviceId}:${ip.address}`,
      )
    if (edge)
      push(
        'ip-edge',
        'warning',
        deviceTarget(ip.deviceId),
        { host: host(ip.deviceId), ip: ip.address, which: edge.which, cidr: edge.cidr },
        `${ip.deviceId}:${ip.address}`,
      )
  }

  const l2 = (i: CheckIface) => i.mode === 'access' || i.mode === 'trunk' || i.mode === 'hybrid'
  const l3Ips = (i: CheckIface) => {
    const owner = i.lagId ?? i.id
    return input.ctx.ips
      .filter((x) => x.interfaceId === owner && (x.role === 'primary' || x.role === 'secondary'))
      .map((x) => x.address)
      .filter((x) => !hostRoute(x))
  }

  // Cables: one per physical port, physical cables on physical ports, media / speed of the two ends.
  const used = new Map<string, CheckLink[]>()
  for (const l of input.links) {
    for (const [iface, kind] of [
      [l.aIface, l.aKind],
      [l.bIface, l.bKind],
    ] as const) {
      if (!iface || kind !== 'device') continue
      const i = ifById.get(iface)
      if (!i) continue
      if (!SHARED.has(l.kind) && i.media !== 'PON') used.set(iface, [...(used.get(iface) ?? []), l])
      if (l.kind !== 'logical' && i.kind !== 'physical')
        push(
          'cable-virtual',
          'error',
          linkTarget(l),
          { host: host(i.deviceId), port: i.name },
          `${l.id}:${iface}`,
        )
    }
    const a = l.aIface ? ifById.get(l.aIface) : undefined
    const b = l.bIface ? ifById.get(l.bIface) : undefined
    if (a && b && l.kind === 'ethernet' && a.media && b.media) {
      const sa = SFP.has(a.media)
      const sb = SFP.has(b.media)
      if ((a.media === 'RJ45' && sb) || (b.media === 'RJ45' && sa))
        push(
          'media-mismatch',
          'info',
          linkTarget(l),
          { a: `${host(a.deviceId)} ${a.name}`, b: `${host(b.deviceId)} ${b.name}` },
          l.id,
        )
    }
    // Speeds are free text ("1G", "1000M", "1 Gbps"); a 10G port on a 1G port is a normal uplink that runs at 1G, so
    // only a note, and only for cables that have a line speed.
    const sa = speedMbps(a?.speed)
    const sb = speedMbps(b?.speed)
    if (a && b && (l.kind === 'ethernet' || l.kind === 'fiber') && sa && sb && sa !== sb)
      push(
        'speed-mismatch',
        // Copper auto-negotiates down to the slower end (a note); two optics of different speeds never link (P2-10).
        SFP.has(a.media) && SFP.has(b.media) ? 'warning' : 'info',
        linkTarget(l),
        {
          a: `${host(a.deviceId)} ${a.name} ${a.speed}`,
          b: `${host(b.deviceId)} ${b.name} ${b.speed}`,
        },
        l.id,
      )
    // L3: two routed ends with addresses but no common subnet, per address family. A LAG member speaks with its
    // parent's addresses; switch ports (access / trunk) and logical cables are not compared.
    if (a && b && l.kind !== 'logical' && !l2(a) && !l2(b)) {
      const ipsA = l3Ips(a)
      const ipsB = l3Ips(b)
      for (const fam of [4, 6]) {
        const fa = ipsA.filter((x) => family(x) === fam)
        const fb = ipsB.filter((x) => family(x) === fam)
        // Both ways: 10.0.0.5/30 and 10.0.0.1/24 do not agree whichever end is A.
        const agree = fa.some((x) => fb.some((y) => sameNetwork(x, y) && sameNetwork(y, x)))
        if (fa.length > 0 && fb.length > 0 && !agree) {
          push(
            'l3-subnet',
            'warning',
            linkTarget(l),
            { a: `${host(a.deviceId)} ${a.name}`, b: `${host(b.deviceId)} ${b.name}` },
            l.id,
          )
          break
        }
      }
    }
    // A physical cable not plugged into a port yet (Info): device ends that can have one.
    if (l.kind !== 'logical' && l.kind !== 'power') {
      for (const [iface, kind, id] of [
        [l.aIface, l.aKind, l.aId],
        [l.bIface, l.bKind, l.bId],
      ] as const)
        if (!iface && kind === 'device' && input.devices[id]?.type !== 'provider_cloud')
          push('cable-no-port', 'info', linkTarget(l), { host: host(id) }, `${l.id}:${id}`)
    }
  }
  for (const [iface, ls] of used)
    if (ls.length > 1) {
      const i = ifById.get(iface)!
      for (const l of ls)
        push(
          'port-multi',
          'error',
          linkTarget(l),
          { host: host(i.deviceId), port: i.name, count: ls.length },
          `${l.id}:${iface}`,
        )
    }

  // Ports: VLAN fields that do not fit the mode; LAG members that differ.
  const lags = new Map<string, CheckIface[]>()
  for (const i of input.ifaces) {
    if (i.mode === 'access' && (i.allowedVlans || i.nativeVlan))
      push(
        'vlan-mode',
        'warning',
        deviceTarget(i.deviceId),
        { host: host(i.deviceId), port: i.name, mode: 'access' },
        i.id,
      )
    if (i.mode === 'trunk' && i.accessVlan)
      push(
        'vlan-mode',
        'warning',
        deviceTarget(i.deviceId),
        { host: host(i.deviceId), port: i.name, mode: 'trunk' },
        i.id,
      )
    if (i.mode === 'routed' && (i.accessVlan || i.nativeVlan || i.allowedVlans))
      push(
        'vlan-mode',
        'warning',
        deviceTarget(i.deviceId),
        { host: host(i.deviceId), port: i.name, mode: 'routed' },
        i.id,
      )
    if (i.lagId) lags.set(i.lagId, [...(lags.get(i.lagId) ?? []), i])
  }
  for (const [lag, members] of lags) {
    // Speed must match for the bundle to come up; mixed media of one speed (copper + fibre 1G) is only odd.
    const speeds = new Set(members.map((m) => m.speed.toLowerCase()).filter(Boolean))
    const media = new Set(members.map((m) => m.media).filter(Boolean))
    const lagName = ifById.get(lag)?.name ?? lag
    const params = { host: host(members[0]!.deviceId), lag: lagName }
    if (speeds.size > 1)
      push('lag-speed', 'warning', deviceTarget(members[0]!.deviceId), params, lag)
    else if (media.size > 1)
      push('lag-media', 'info', deviceTarget(members[0]!.deviceId), params, lag)
  }

  // Clusters: members on the diagram with a different model / firmware.
  const clusters = new Map<string, typeof input.ctx.devices>()
  for (const d of input.ctx.devices)
    if (d.clusterId) clusters.set(d.clusterId, [...(clusters.get(d.clusterId) ?? []), d])
  for (const members of clusters.values()) {
    if (members.length < 2) continue
    // Firmware must match to form HA or a stack; mixed models of one series are supported in many stacks (Info).
    const models = new Set(members.map((m) => m.model.trim().toLowerCase()).filter(Boolean))
    const firmwares = new Set(members.map((m) => m.firmware.trim().toLowerCase()).filter(Boolean))
    const stack = members.some((m) => input.devices[m.id]?.clusterKind === 'stack')
    for (const m of members) {
      if (firmwares.size > 1)
        push('cluster-firmware', 'warning', deviceTarget(m.id), { host: m.hostname }, m.id)
      if (models.size > 1)
        push(
          'cluster-model',
          stack ? 'info' : 'warning',
          deviceTarget(m.id),
          { host: m.hostname },
          m.id,
        )
    }
  }

  // Endpoint group members outside the group's range.
  for (const g of input.ctx.groups) {
    if (!g.rangeStart || !g.rangeEnd) continue
    for (const m of g.members)
      if (!inRange(m.ip, g.rangeStart, g.rangeEnd))
        push(
          'member-outside-range',
          'warning',
          deviceTarget(g.id),
          { group: g.name, member: m.name, ip: m.ip, start: g.rangeStart, end: g.rangeEnd },
          `${g.id}:${m.ip}`,
        )
  }

  // Frames: a device inside a site / location frame whose real site / location differs (never changed automatically).
  for (const n of input.nodes) {
    if (n.refKind !== 'device') continue
    const d = input.devices[n.refId]
    if (!d || d.type === 'provider_cloud') continue
    const cx = n.x + NODE_W / 2
    const cy = n.y + NODE_H / 2
    const frame = input.frames
      .filter(
        (f) =>
          (f.page ?? '') === (n.page ?? '') &&
          cx >= f.x &&
          cx <= f.x + f.w &&
          cy >= f.y &&
          cy <= f.y + f.h,
      )
      .sort((p, q) => p.w * p.h - q.w * q.h)[0]
    if (!frame) continue
    const loc = ctxDevice.get(n.refId)?.locationId ?? null
    if (frame.siteId !== d.siteId || (frame.locationId && loc && frame.locationId !== loc))
      push('frame-site', 'warning', { kind: 'node', id: n.id }, { host: d.hostname }, n.id)
  }

  phase2(input, push, linkTarget, deviceTarget, host, ifById, ctxDevice)

  // Info: devices without any cable; IPs but no management interface.
  const cabled = new Set<string>()
  for (const l of input.links) {
    cabled.add(l.aId)
    cabled.add(l.bId)
  }
  for (const n of input.nodes) {
    if (n.refKind !== 'device' || cabled.has(n.refId)) continue
    const d = input.devices[n.refId]
    if (d && d.type !== 'patch_panel')
      push('no-cable', 'info', { kind: 'node', id: n.id }, { host: d.hostname }, n.refId)
  }
  for (const d of input.ctx.devices) {
    const hasIp = input.ctx.ips.some(
      (x) => x.deviceId === d.id && x.interfaceId && x.role === 'primary',
    )
    if (hasIp && !d.mgmtInterfaceId && !d.clusterId)
      push('no-mgmt', 'info', deviceTarget(d.id), { host: d.hostname }, d.id)
  }

  const seen = new Set<string>()
  return out.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)))
}

/** Shared passwords worth a warning from this many devices on (P2-10); SNMP communities are shared by design. */
export const SHARED_CREDENTIAL_MIN = 5
const SHARED_EXEMPT = new Set(['snmp'])
/** Device kinds with nothing to track (no S/N / part number expected): virtual, external, passive, endpoints. */
const NO_ASSET = new Set([
  'provider_cloud',
  'vm',
  'patch_panel',
  'pc',
  'laptop',
  'ip_phone',
  'iot',
  'other',
  'printer',
])
/** Network devices (both ends of a LAG are these; a server's NIC teaming is not a LAG mismatch). */
const NETWORK = new Set([
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
])
const SWITCHES = new Set(['l2_switch', 'l3_switch', 'poe_switch'])
/** An SVI's VLAN from its name: Vlan10, Vlanif10, vlan.10, irb.10. */
const sviVid = (name: string): number | null => {
  const m = name.match(/^(?:vlan(?:if)?|irb|bvi)\W?(\d{1,4})$/i)
  return m ? Number(m[1]) : null
}

type Push = (
  rule: string,
  severity: Severity,
  target: Problem['target'] | null,
  params: Problem['params'],
  key: string,
) => void

/**
 * Phase 2 rules (SRS §7, P2-10): VLAN mismatches on a cable (the L2 view's logic), a VLAN used on a switch's access
 * ports that none of its cabled trunks carries, duplex mismatches, active devices missing asset facts, and passwords
 * shared by many devices.
 */
function phase2(
  input: CheckInput,
  push: Push,
  linkTarget: (l: CheckLink) => Problem['target'] | null,
  deviceTarget: (id: string) => Problem['target'] | null,
  host: (id: string) => string,
  ifById: Map<string, CheckIface>,
  ctxDevice: Map<string, ValidationContext['devices'][number]>,
) {
  // A LAG member follows its LAG when the LAG has a mode (settings on the port-channel).
  const effective = (i: CheckIface): CheckIface => {
    const lag = i.lagId ? ifById.get(i.lagId) : undefined
    return lag && lag.mode ? { ...lag, id: i.id, name: i.name, lagId: i.lagId } : i
  }
  const portL2 = (i: CheckIface): PortL2 => {
    const e = effective(i)
    const lag = i.lagId ? ifById.get(i.lagId) : undefined
    return {
      mode: e.mode as PortL2['mode'],
      access: e.accessVlan,
      native: e.nativeVlan,
      allowed: e.allowedVlans,
      lagId: i.lagId,
      lagName: lag?.name ?? '',
    }
  }
  const label = (i: CheckIface) => `${host(i.deviceId)} ${i.name}`
  const cabled = new Set<string>()
  const seenLag = new Set<string>()
  for (const l of input.links) {
    if (l.aIface) cabled.add(l.aIface)
    if (l.bIface) cabled.add(l.bIface)
    const a = l.aIface && l.aKind === 'device' ? ifById.get(l.aIface) : undefined
    const b = l.bIface && l.bKind === 'device' ? ifById.get(l.bIface) : undefined
    // Only data cables carry VLANs between two switchports.
    if (!a || !b || (l.kind !== 'ethernet' && l.kind !== 'fiber')) continue
    const typeA = ctxDevice.get(a.deviceId)?.type ?? ''
    const typeB = ctxDevice.get(b.deviceId)?.type ?? ''
    // VLANs: only two switchports are compared (a camera / router end has nothing to compare with).
    const facts = classifyL2(portL2(a), portL2(b))
    // The members of one LAG pair say it once.
    const lagKey = a.lagId && b.lagId ? [a.lagId, b.lagId].sort().join('|') : ''
    for (const issue of facts.issues) {
      const key = lagKey ? `${lagKey}:${issue.key}` : `${l.id}:${issue.key}`
      if (seenLag.has(key)) continue
      seenLag.add(key)
      const v = issue.values
      const ends = { a: label(a), b: label(b) }
      switch (issue.key) {
        case 'accessDiffers':
          push('vlan-access', 'warning', linkTarget(l), { ...ends, va: v.a!, vb: v.b! }, key)
          break
        case 'nativeDiffers':
          push('vlan-native', 'warning', linkTarget(l), { ...ends, va: v.a!, vb: v.b! }, key)
          break
        case 'nativeOneSide':
          push('vlan-native-one', 'info', linkTarget(l), { ...ends, va: v.a!, vb: v.b! }, key)
          break
        case 'allowedOneSide':
          push('vlan-allowed', 'info', linkTarget(l), { ...ends, vlans: v.vlans! }, key)
          break
        case 'accessToTrunk':
          push(
            'vlan-access-trunk',
            'warning',
            linkTarget(l),
            { ...ends, access: v.access!, native: v.native! },
            key,
          )
          break
        case 'lagOneSide':
          if (NETWORK.has(typeA) && NETWORK.has(typeB))
            push('lag-one-side', 'warning', linkTarget(l), { ...ends, lag: v.lag! }, key)
          break
      }
    }
    // Duplex (copper only; fibre / SFP and multi-gigabit are always full): full against half is wrong; a forced end
    // against auto is the classic slow link below 1G (the auto end falls back to half) — at 1G copper auto-negotiation
    // is mandatory, so only a note; forced half against auto both run half (a note).
    const da = a.duplex || 'auto'
    const db = b.duplex || 'auto'
    const copper = (i: CheckIface) =>
      i.kind === 'physical' && (i.media === 'RJ45' || i.media === '')
    const fast = Math.min(speedMbps(a.speed) ?? 0, speedMbps(b.speed) ?? 0)
    const fastest = Math.max(speedMbps(a.speed) ?? 0, speedMbps(b.speed) ?? 0)
    if (da !== db && copper(a) && copper(b) && fastest <= 1000 && l.kind === 'ethernet') {
      const pair = new Set([da, db])
      const level: Severity =
        pair.has('full') && pair.has('half')
          ? 'warning'
          : pair.has('half')
            ? 'info'
            : fast >= 1000
              ? 'info'
              : 'warning'
      push(
        'duplex-mismatch',
        level,
        linkTarget(l),
        { a: label(a), b: label(b), da, db },
        `${l.id}:duplex`,
      )
    }
  }

  // A VLAN on a switch's access ports that none of its cabled trunks carries cannot leave the switch. A stack / HA pair
  // is one switch; a VLAN with an SVI on it is routed right there.
  const byDevice = new Map<string, CheckIface[]>()
  const ownerOf = (deviceId: string) => ctxDevice.get(deviceId)?.clusterId ?? deviceId
  for (const i of input.ifaces) {
    const k = ownerOf(i.deviceId)
    byDevice.set(k, [...(byDevice.get(k) ?? []), i])
  }
  for (const [, ports] of byDevice) {
    const deviceId = ports[0]!.deviceId
    const d = ctxDevice.get(deviceId)
    if (!d || d.managed === false || !SWITCHES.has(d.type) || d.lifecycle !== 'active') continue
    const routed = new Set(
      ports
        .filter((i) => i.kind === 'svi')
        .map((i) => sviVid(i.name))
        .filter((v) => v !== null),
    )
    const trunks = ports
      .filter((i) => i.kind === 'physical' && cabled.has(i.id))
      .map(effective)
      .filter((i) => i.mode === 'trunk' || i.mode === 'hybrid')
    // Without a cabled trunk (or with one whose list nobody filled in) there is nothing to say.
    if (trunks.length === 0 || trunks.some((i) => i.allowedVlans.trim() === '')) continue
    const carried = (vid: number) =>
      trunks.some(
        (i) => vlanSetHas(parseVlanList(i.allowedVlans), vid) || (i.nativeVlan ?? 1) === vid,
      )
    const used = new Map<number, string[]>()
    for (const i of ports) {
      const e = effective(i)
      if (e.mode !== 'access' || !e.accessVlan || !cabled.has(i.id)) continue
      used.set(e.accessVlan, [...(used.get(e.accessVlan) ?? []), i.name])
    }
    for (const [vid, names] of used)
      if (!carried(vid) && !routed.has(vid))
        push(
          'vlan-isolated',
          'warning',
          deviceTarget(deviceId),
          {
            host: host(deviceId),
            vlan: vid,
            ports: names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''),
          },
          `${deviceId}:${vid}`,
        )
  }

  // Active devices without the facts warranty / support needs (location only where the site has locations).
  const withLocations = new Set(input.ctx.sitesWithLocations ?? [])
  for (const n of input.nodes) {
    if (n.refKind !== 'device') continue
    const d = ctxDevice.get(n.refId)
    if (!d || d.lifecycle !== 'active' || d.managed === false || NO_ASSET.has(d.type)) continue
    const missing = [
      !d.serialNumber && 'serial',
      // A model name is enough to look the product up; the part number is asked for only when both are missing.
      d.partNumber === '' && !d.model && 'part',
      !d.locationId && withLocations.has(d.siteId) && 'location',
    ].filter(Boolean)
    if (missing.length > 0)
      push(
        'missing-info',
        'info',
        { kind: 'node', id: n.id },
        { host: d.hostname, fields: missing.join(',') },
        n.refId,
      )
  }

  // One password on many devices: one leak opens them all.
  for (const c of input.ctx.credentials ?? []) {
    // Boxes in use, a stack / HA pair counted once (the server counts them).
    if (SHARED_EXEMPT.has(c.kind) || (c.logicalCount ?? c.deviceIds.length) < SHARED_CREDENTIAL_MIN)
      continue
    const here = c.deviceIds.map((id) => deviceTarget(id)).find(Boolean) ?? null
    push(
      'credential-shared',
      'warning',
      here,
      { name: c.name, count: c.logicalCount ?? c.deviceIds.length },
      c.id,
    )
  }
}
