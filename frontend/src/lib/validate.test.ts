import { describe, expect, it } from 'vitest'
import { isValidCidr, parseCidrList } from './validate'

describe('lib: CIDR validation (ipaddr.js)', () => {
  it('accepts valid IPv4 CIDRs', () => {
    expect(isValidCidr('10.0.0.1/24')).toBe(true)
    expect(isValidCidr('192.168.30.31/32')).toBe(true)
    expect(isValidCidr('0.0.0.0/0')).toBe(true)
  })

  it('rejects malformed CIDRs', () => {
    expect(isValidCidr('10.0.0.1')).toBe(false)
    expect(isValidCidr('10.0.0.1/33')).toBe(false)
    expect(isValidCidr('abc/24')).toBe(false)
    expect(isValidCidr('10.0.0/24')).toBe(false)
  })

  it('empty string is valid (optional field)', () => {
    expect(isValidCidr('')).toBe(true)
    expect(isValidCidr('   ')).toBe(true)
  })

  it('parseCidrList splits on commas and whitespace', () => {
    expect(parseCidrList('10.0.0.1/24, 192.168.1.1/30\n172.16.0.1/16')).toEqual([
      '10.0.0.1/24',
      '192.168.1.1/30',
      '172.16.0.1/16',
    ])
  })

  it('parseCidrList throws on any invalid entry', () => {
    expect(() => parseCidrList('10.0.0.1/24, bad')).toThrow(/invalid CIDR/)
  })
})
