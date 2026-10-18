import ipaddr from 'ipaddr.js'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import { parseCidr } from '@/editor/validation/cidr'
import i18n from '@/i18n'

// IPAM basics (P1-10, SRS §5): VLANs, subnets, planned ranges, usage, next free address, IP lookup.

export type Vlan = components['schemas']['Vlan']
export type VlanInput = components['schemas']['VlanInput']
export type Subnet = components['schemas']['Subnet']
export type SubnetDetail = components['schemas']['SubnetDetail']
export type SubnetInput = components['schemas']['SubnetInput']
export type IpRange = components['schemas']['IpRange']
export type IpRangeInput = components['schemas']['IpRangeInput']
export type IpRangeKind = components['schemas']['IpRangeKind']
export type IpLookup = components['schemas']['IpLookup']
export type IpAssignment = components['schemas']['IpAssignment']

export const RANGE_KINDS: IpRangeKind[] = ['dhcp', 'static', 'reserved']

/** Default VLAN colours (Tailwind 500 shades); the colour is shared by every diagram (SRS §5). */
export const VLAN_COLORS = [
  '#64748b',
  '#0ea5e9',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
]

/** Used share of a subnet or range in percent (0–100), rounded down so "100%" means really full. */
export function usagePercent(used: number, size: number): number {
  if (size <= 0) return 0
  return Math.min(100, Math.floor((used / size) * 100))
}

/** Usage level for colouring: ≥90% critical, ≥75% warning (DESIGN.md dashboard: "Subnet ≥90%"). */
export function usageLevel(percent: number): 'ok' | 'warn' | 'critical' {
  return percent >= 90 ? 'critical' : percent >= 75 ? 'warn' : 'ok'
}

/** Huge IPv6 sizes are capped by the server at 2^63−1; show them as "rất lớn". */
export function formatSize(size: number): string {
  return size >= 2 ** 53 ? '∞' : size.toLocaleString('vi-VN')
}

function fail(error: unknown, status: number, fallback: string): never {
  throw new Error(errorMessage(error, status, fallback))
}

const keys = {
  all: (orgId: string) => ['orgs', orgId, 'ipam'] as const,
  vlans: (orgId: string, siteId: string) => ['orgs', orgId, 'ipam', 'vlans', siteId] as const,
  subnets: (orgId: string, siteId: string, q: string) =>
    ['orgs', orgId, 'ipam', 'subnets', siteId, q] as const,
  subnet: (orgId: string, id: string) => ['orgs', orgId, 'ipam', 'subnet', id] as const,
  lookup: (orgId: string, ip: string) => ['orgs', orgId, 'ipam', 'lookup', ip] as const,
}

/** VLANs of a site plus the organization-wide ones (siteId ''), or all VLANs (siteId undefined). */
export function useVlans(orgId: string, siteId?: string) {
  return useQuery({
    queryKey: keys.vlans(orgId, siteId ?? '*'),
    enabled: orgId !== '',
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/vlans', {
        params: { path: { orgId }, query: { siteId: siteId || undefined } },
      })
      if (r.data) return r.data.vlans
      fail(r.error, r.response.status, i18n.t('errors.ipamLoad'))
    },
  })
}

export function useSubnets(orgId: string, siteId: string, q: string) {
  return useQuery({
    queryKey: keys.subnets(orgId, siteId, q),
    enabled: orgId !== '',
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/subnets', {
        params: { path: { orgId }, query: { siteId: siteId || undefined, q: q || undefined } },
      })
      if (r.data) return r.data.subnets
      fail(r.error, r.response.status, i18n.t('errors.ipamLoad'))
    },
  })
}

/** Query options of one subnet with its ranges and addresses (also used for several at once: IP plan table). */
export function subnetQuery(orgId: string, subnetId: string) {
  return {
    queryKey: keys.subnet(orgId, subnetId),
    enabled: orgId !== '' && subnetId !== '',
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/subnets/{subnetId}', {
        params: { path: { orgId, subnetId } },
      })
      if (r.data) return r.data
      return fail(r.error, r.response.status, i18n.t('errors.ipamLoad'))
    },
  }
}

export function useSubnet(orgId: string, subnetId: string) {
  return useQuery(subnetQuery(orgId, subnetId))
}

/** Who uses an address: containing subnets and interface assignments. */
export function useIpLookup(orgId: string, ip: string) {
  return useQuery({
    queryKey: keys.lookup(orgId, ip),
    enabled: orgId !== '' && ip !== '',
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/ipam/lookup', {
        params: { path: { orgId }, query: { ip } },
      })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.ipamLoad'))
    },
  })
}

/** The first unused address of a subnet (with its prefix, e.g. 10.72.114.10/24), or null when full. */
export async function fetchNextFree(orgId: string, subnetId: string): Promise<string | null> {
  const r = await api.GET('/orgs/{orgId}/subnets/{subnetId}/next-free', {
    params: { path: { orgId, subnetId } },
  })
  if (r.data) return r.data.address ?? null
  fail(r.error, r.response.status, i18n.t('errors.ipamLoad'))
}

/** IPAM writes change counts across VLANs, subnets and lookups: refresh all of IPAM. */
export function useIpamMutations(orgId: string) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: keys.all(orgId) })
  const saveVlan = useMutation({
    mutationFn: async (input: { vlan?: Vlan; body: VlanInput }) => {
      const r = input.vlan
        ? await api.PATCH('/orgs/{orgId}/vlans/{vlanId}', {
            params: { ...csrfParam, path: { orgId, vlanId: input.vlan.id } },
            body: { ...input.body, version: input.vlan.version },
          })
        : await api.POST('/orgs/{orgId}/vlans', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const removeVlan = useMutation({
    mutationFn: async (vlanId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/vlans/{vlanId}', {
        params: { ...csrfParam, path: { orgId, vlanId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  const saveSubnet = useMutation({
    mutationFn: async (input: { subnet?: Subnet; body: SubnetInput }) => {
      const r = input.subnet
        ? await api.PATCH('/orgs/{orgId}/subnets/{subnetId}', {
            params: { ...csrfParam, path: { orgId, subnetId: input.subnet.id } },
            body: { ...input.body, version: input.subnet.version },
          })
        : await api.POST('/orgs/{orgId}/subnets', {
            params: { ...csrfParam, path: { orgId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const removeSubnet = useMutation({
    mutationFn: async (subnetId: string) => {
      const r = await api.DELETE('/orgs/{orgId}/subnets/{subnetId}', {
        params: { ...csrfParam, path: { orgId, subnetId } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  const saveRange = useMutation({
    mutationFn: async (input: { subnetId: string; range?: IpRange; body: IpRangeInput }) => {
      const r = input.range
        ? await api.PATCH('/orgs/{orgId}/subnets/{subnetId}/ranges/{rangeId}', {
            params: {
              ...csrfParam,
              path: { orgId, subnetId: input.subnetId, rangeId: input.range.id },
            },
            body: { ...input.body, version: input.range.version },
          })
        : await api.POST('/orgs/{orgId}/subnets/{subnetId}/ranges', {
            params: { ...csrfParam, path: { orgId, subnetId: input.subnetId } },
            body: input.body,
          })
      if (r.data) return r.data
      fail(r.error, r.response.status, i18n.t('errors.save'))
    },
    onSettled,
  })
  const removeRange = useMutation({
    mutationFn: async (input: { subnetId: string; rangeId: string }) => {
      const r = await api.DELETE('/orgs/{orgId}/subnets/{subnetId}/ranges/{rangeId}', {
        params: { ...csrfParam, path: { orgId, ...input } },
      })
      if (r.response.status !== 204) fail(r.error, r.response.status, i18n.t('errors.actionFailed'))
    },
    onSettled,
  })
  return { saveVlan, removeVlan, saveSubnet, removeSubnet, saveRange, removeRange }
}

export type SubnetPreview = {
  network: string
  first: string
  last: string
  count: number
  mask: string
  single: boolean
}

/** Live description of an IPv4 CIDR typed in a form (network, usable range, mask); null when not IPv4 CIDR. */
export function describeSubnet(cidr: string): SubnetPreview | null {
  const c = parseCidr(cidr)
  if (!c) return null
  const dot = (o: number[]) => o.join('.')
  const toInt = (o: number[]) => ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
  const fromInt = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
  const net = toInt(c.network)
  const bc = toInt(c.broadcast)
  const small = c.prefix >= 31
  const maskInt = c.prefix === 0 ? 0 : (0xffffffff << (32 - c.prefix)) >>> 0
  return {
    network: `${dot(c.network)}/${c.prefix}`,
    first: dot(fromInt(small ? net : net + 1)),
    last: dot(fromInt(small ? bc : bc - 1)),
    count: small ? bc - net + 1 : bc - net - 1,
    mask: dot(fromInt(maskInt)),
    single: c.prefix === 32,
  }
}

/** A subnet nested in another of the same VRF (P2-09); `inUse` = the outer one is a real subnet, not a plan block. */
export interface Nesting {
  parent: string
  parentCidr: string
  inUse: boolean
}

/**
 * Subnets nested in another subnet of the same VRF (CIDRs are nested or apart, never half-overlapping). Inside a plan
 * block (no gateway, VLAN or range) it is normal; inside a subnet in use it is an overlap worth fixing — often a
 * mistyped mask (a /23 holding a /24).
 */
export function nestings(
  subnets: Pick<Subnet, 'id' | 'cidr' | 'vrf' | 'gateway' | 'vlanId' | 'rangeCount'>[],
): Map<string, Nesting> {
  const parsed = subnets.flatMap((s) => {
    try {
      return [{ s, p: ipaddr.parseCIDR(s.cidr) }]
    } catch {
      return []
    }
  })
  const out = new Map<string, Nesting>()
  for (const x of parsed) {
    const outer = parsed
      .filter(
        (y) =>
          y.s.id !== x.s.id &&
          y.s.vrf === x.s.vrf &&
          y.p[0].kind() === x.p[0].kind() &&
          y.p[1] < x.p[1] &&
          x.p[0].match(y.p),
      )
      .sort((a, b) => b.p[1] - a.p[1])[0]
    if (outer)
      out.set(x.s.id, {
        parent: outer.s.id,
        parentCidr: outer.s.cidr,
        inUse: Boolean(outer.s.gateway || outer.s.vlanId || outer.s.rangeCount > 0),
      })
  }
  return out
}

export interface PoolWarning {
  kind: 'gateway-in-dhcp' | 'static-in-dhcp'
  host: string
  who: string
  pool: string
}

/**
 * Static addresses inside the subnet's DHCP pools (P2-09): device interfaces and cluster IPs — not endpoint group
 * members (DHCP clients) nor NAT / public addresses; the subnet's gateway in a pool is its own warning.
 */
export function poolWarnings(
  detail: Pick<SubnetDetail, 'gateway' | 'ranges' | 'ips'>,
): PoolWarning[] {
  const pools = detail.ranges.filter((r) => r.kind === 'dhcp')
  if (pools.length === 0) return []
  const holds = (ip: string) => {
    try {
      const a = ipaddr.parse(ip).toByteArray()
      return pools.find((r) => {
        const s = ipaddr.parse(r.startIp).toByteArray()
        const e = ipaddr.parse(r.endIp).toByteArray()
        const cmp = (x: number[], y: number[]) => {
          for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
          return 0
        }
        return a.length === s.length && cmp(a, s) >= 0 && cmp(a, e) <= 0
      })
    } catch {
      return undefined
    }
  }
  const out: PoolWarning[] = []
  const gw = detail.gateway ? holds(detail.gateway) : undefined
  if (gw && detail.gateway)
    out.push({
      kind: 'gateway-in-dhcp',
      host: detail.gateway,
      who: '',
      pool: `${gw.startIp}–${gw.endIp}`,
    })
  for (const ip of detail.ips) {
    if (ip.endpointGroupId || (ip.role !== 'primary' && ip.role !== 'secondary')) continue
    const r = holds(ip.host)
    if (r)
      out.push({
        kind: 'static-in-dhcp',
        host: ip.host,
        who: [ip.hostname, ip.interfaceName].filter(Boolean).join(' '),
        pool: `${r.startIp}–${r.endIp}`,
      })
  }
  return out
}
