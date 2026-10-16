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
