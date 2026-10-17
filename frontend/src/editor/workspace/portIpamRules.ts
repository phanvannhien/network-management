import ipaddr from 'ipaddr.js'
import type { components } from '@/api/client'

// Helpers of the panel IPAM (P1-18, ADR-034).

type Interface = components['schemas']['Interface']
type InterfaceInput = components['schemas']['InterfaceInput']

export function interfaceInput(i: Interface): InterfaceInput {
  return {
    name: i.name,
    kind: i.kind,
    media: i.media,
    speed: i.speed,
    duplex: i.duplex,
    mode: i.mode,
    accessVlan: i.accessVlan,
    nativeVlan: i.nativeVlan,
    allowedVlans: i.allowedVlans,
    poe: i.poe,
    lagId: i.lagId,
    description: i.description,
    adminUp: i.adminUp,
    mac: i.mac,
    vlanTag: i.vlanTag,
  }
}

/** Network / broadcast address of an IPv4 subnet (/31 and /32 have none); '' when fine or not IPv4. */
export function addressProblem(cidr: string): 'network' | 'broadcast' | '' {
  try {
    const [addr, len] = ipaddr.parseCIDR(cidr)
    if (addr.kind() !== 'ipv4' || len >= 31) return ''
    const net = ipaddr.IPv4.networkAddressFromCIDR(cidr).toString()
    const bcast = ipaddr.IPv4.broadcastAddressFromCIDR(cidr).toString()
    const host = addr.toString()
    return host === net ? 'network' : host === bcast ? 'broadcast' : ''
  } catch {
    return ''
  }
}
