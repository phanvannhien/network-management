import ipaddr from 'ipaddr.js'
import type { DocState } from '../doc/types'
import type { Problem, Severity, ValidationContext } from './types'

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
}

export interface CheckInput {
  nodes: { id: string; refKind: string; refId: string; x: number; y: number }[]
  devices: Record<
    string,
    { hostname: string; type: string; siteId: string; draft: boolean; clusterKind: string }
  >
  frames: {
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
export function buildCheckInput(doc: DocState, ctx: ValidationContext): CheckInput {
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
    }
  return {
    nodes: doc.view.nodes.map((n) => ({
      id: n.id,
      refKind: n.refKind,
      refId: n.refId,
      x: n.x,
      y: n.y,
    })),
    devices,
    frames: doc.view.annotations
      .filter((a) => a.kind === 'zone' && a.siteId)
      .map((a) => ({
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
        'info',
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
      .filter((f) => cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)
      .sort((p, q) => p.w * p.h - q.w * q.h)[0]
    if (!frame) continue
    const loc = ctxDevice.get(n.refId)?.locationId ?? null
    if (frame.siteId !== d.siteId || (frame.locationId && loc && frame.locationId !== loc))
      push('frame-site', 'warning', { kind: 'node', id: n.id }, { host: d.hostname }, n.id)
  }

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
      push('no-cable', 'info', { kind: 'node', id: n.id }, { host: d.hostname }, n.id)
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
