import { describe, expect, it } from 'vitest'
import { safeNext } from './safeNext'

describe('safeNext (P2-14)', () => {
  it('keeps app paths and refuses anything that leaves the app', () => {
    expect(safeNext('/o/1/devices?x=1#a')).toBe('/o/1/devices?x=1#a')
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil',
      'javascript:alert(1)',
      '/a\nb',
      '/a\tb',
      'evil',
    ])
      expect(safeNext(bad)).toBe('/')
  })
})
