import { describe, expect, it } from 'vitest'
import { describeSubnet, formatSize, usageLevel, usagePercent } from './ipam'

describe('ipam: subnet maths', () => {
  it('describes an IPv4 network from any address inside it', () => {
    expect(describeSubnet('10.72.114.7/24')).toEqual({
      network: '10.72.114.0/24',
      first: '10.72.114.1',
      last: '10.72.114.254',
      count: 254,
      mask: '255.255.255.0',
      single: false,
    })
    expect(describeSubnet('10.255.0.0/30')).toMatchObject({
      first: '10.255.0.1',
      last: '10.255.0.2',
      count: 2,
    })
    // /31 point-to-point links use both addresses (RFC 3021); /32 is a single host.
    expect(describeSubnet('10.255.0.0/31')).toMatchObject({
      first: '10.255.0.0',
      last: '10.255.0.1',
      count: 2,
    })
    expect(describeSubnet('10.255.0.9/32')).toMatchObject({ single: true, count: 1 })
    expect(describeSubnet('10.0.0.0/8')).toMatchObject({ count: 16777214, mask: '255.0.0.0' })
  })

  it('returns null for what is not an IPv4 CIDR', () => {
    expect(describeSubnet('10.72.114.0')).toBeNull()
    expect(describeSubnet('10.72/16')).toBeNull()
    expect(describeSubnet('2001:db8::/64')).toBeNull()
  })

  it('usage percent rounds down and levels warn at 75% and 90%', () => {
    expect(usagePercent(253, 254)).toBe(99)
    expect(usagePercent(254, 254)).toBe(100)
    expect(usagePercent(1, 0)).toBe(0)
    expect(usageLevel(74)).toBe('ok')
    expect(usageLevel(75)).toBe('warn')
    expect(usageLevel(90)).toBe('critical')
  })

  it('huge IPv6 sizes show as infinite', () => {
    expect(formatSize(2 ** 63 - 1)).toBe('∞')
    expect(formatSize(254)).toBe('254')
  })
})

describe('IPAM warnings (P2-09)', () => {
  it('tells an overlap inside a subnet in use from a subnet inside a plan block', async () => {
    const { nestings } = await import('./ipam')
    const sn = (id: string, cidr: string, extra: Record<string, unknown> = {}) => ({
      id,
      cidr,
      vrf: '',
      gateway: null,
      vlanId: null,
      rangeCount: 0,
      ...extra,
    })
    const n = nestings([
      sn('block', '10.0.0.0/16'),
      sn('lan', '10.0.20.0/24', { gateway: '10.0.20.1' }),
      sn('typo', '10.0.20.0/25'),
      sn('guest', '10.0.20.0/24', { vrf: 'GUEST' }),
    ] as never)
    expect(n.get('lan')).toMatchObject({ parentCidr: '10.0.0.0/16', inUse: false })
    expect(n.get('typo')).toMatchObject({ parentCidr: '10.0.20.0/24', inUse: true })
    expect(n.has('guest')).toBe(false)
    expect(n.has('block')).toBe(false)
  })

  it('lists static IPs and the gateway inside DHCP pools, not endpoint members or NAT', async () => {
    const { poolWarnings } = await import('./ipam')
    const ip = (host: string, extra: Record<string, unknown> = {}) => ({
      host,
      role: 'primary',
      endpointGroupId: null,
      hostname: 'SW01',
      interfaceName: 'Vlan20',
      ...extra,
    })
    const w = poolWarnings({
      gateway: '10.1.20.100',
      ranges: [{ kind: 'dhcp', startIp: '10.1.20.100', endIp: '10.1.20.200' }],
      ips: [
        ip('10.1.20.150'),
        ip('10.1.20.10'),
        ip('10.1.20.160', { endpointGroupId: 'g' }),
        ip('10.1.20.170', { role: 'nat' }),
      ],
    } as never)
    expect(w.map((x) => [x.kind, x.host])).toEqual([
      ['gateway-in-dhcp', '10.1.20.100'],
      ['static-in-dhcp', '10.1.20.150'],
    ])
  })
})
