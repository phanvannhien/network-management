import { describe, expect, it } from 'vitest'
import { ORG_COLORS, orgColor, orgInitials } from './orgAvatar'

describe('org avatar', () => {
  it('takes the first letters of the first two words', () => {
    expect(orgInitials('Văn phòng mẫu')).toBe('VP')
    expect(orgInitials('  công ty   khách hàng A ')).toBe('CT')
    expect(orgInitials('Đông')).toBe('ĐÔ')
    expect(orgInitials('')).toBe('?')
  })

  it('gives each organization a stable palette colour', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(orgColor(id)).toBe(orgColor(id))
    expect(ORG_COLORS).toContain(orgColor(id))
    const used = new Set(Array.from({ length: 64 }, (_, i) => orgColor(`org-${i}`)))
    expect(used.size).toBeGreaterThan(4) // spreads over the palette
  })
})

describe('cn', () => {
  it('treats token font sizes as sizes, not colours', async () => {
    const { cn } = await import('./utils')
    expect(cn('text-primary-foreground', 'text-form')).toBe('text-primary-foreground text-form')
    expect(cn('text-table', 'text-form')).toBe('text-form')
  })
})

describe('formatDateTime', () => {
  it('prints HH:mm dd/MM', async () => {
    const { formatDateTime } = await import('./format')
    expect(formatDateTime(new Date(2026, 9, 6, 9, 5).toISOString())).toBe('09:05 06/10')
  })
})
