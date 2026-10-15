import ipaddr from 'ipaddr.js'

const STRICT_IPV4_CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/

export interface CidrInfo {
  address: number[]
  prefix: number
  network: number[]
  broadcast: number[]
}

function toInt(octets: number[]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

function fromInt(value: number): number[] {
  const v = value >>> 0
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

function maskInt(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

/**
 * Parses a strict dotted-quad IPv4 CIDR into address/network/broadcast octets.
 * Returns null for anything malformed (shorthands like "10.0.0/24" rejected).
 */
export function parseCidr(cidr: string): CidrInfo | null {
  const value = cidr.trim()
  if (!STRICT_IPV4_CIDR.test(value)) return null
  try {
    const [parsed, prefix] = ipaddr.parseCIDR(value)
    if (parsed.kind() !== 'ipv4') return null
    const address = (parsed as { octets: number[] }).octets
    const network = fromInt(toInt(address) & maskInt(prefix))
    const broadcast = fromInt(toInt(network) | (maskInt(prefix) ^ 0xffffffff))
    return { address, prefix, network, broadcast }
  } catch {
    return null
  }
}

/** True when the address is the network address of its own CIDR. */
export function isNetworkAddress(cidr: string): boolean {
  const info = parseCidr(cidr)
  return info !== null && toInt(info.address) === toInt(info.network)
}

/** True when the address is the broadcast address of its own CIDR. */
export function isBroadcastAddress(cidr: string): boolean {
  const info = parseCidr(cidr)
  return info !== null && toInt(info.address) === toInt(info.broadcast)
}

/** True when `ip` (plain IPv4) falls inside `cidr`. */
export function cidrContains(cidr: string, ip: string): boolean {
  const info = parseCidr(cidr)
  if (info === null) return false
  try {
    const parsed = ipaddr.parse(ip.trim())
    if (parsed.kind() !== 'ipv4') return false
    const octets = (parsed as { octets: number[] }).octets
    const network = fromInt(toInt(octets) & maskInt(info.prefix))
    return network.join('.') === info.network.join('.')
  } catch {
    return false
  }
}

/** Network key ("10.0.0.0/24") of a CIDR, for comparing L3 subnets. */
export function networkKey(cidr: string): string | null {
  const info = parseCidr(cidr)
  return info === null ? null : `${info.network.join('.')}/${info.prefix}`
}
