import ipaddr from 'ipaddr.js'

const STRICT_IPV4_CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/

/**
 * Validates a CIDR string like "10.0.0.1/24". Empty string is valid (optional field).
 * Strict dotted-quad form: ipaddr.js alone would also accept shorthands like "10.0.0/24".
 */
export function isValidCidr(input: string): boolean {
  const value = input.trim()
  if (value === '') return true
  if (!STRICT_IPV4_CIDR.test(value)) return false
  try {
    ipaddr.parseCIDR(value)
    return true
  } catch {
    return false
  }
}

/** Parses a comma/space separated list of CIDRs; throws on the first invalid entry. */
export function parseCidrList(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      if (!isValidCidr(s)) throw new Error(`invalid CIDR: ${s}`)
      return s
    })
}
