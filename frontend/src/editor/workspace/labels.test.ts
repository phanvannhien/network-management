import { describe, expect, it } from 'vitest'
import { DEFAULT_LABEL, presetOf, renderLabel } from './labels'

describe('device labels (P1-18, SRS §6.3)', () => {
  const card = { hostname: 'FW01', mgmtIp: '10.0.0.1/24', model: '80F', siteCode: 'CJ-FV-IDC' }
  it('renders the template; the IP drops its prefix; empty fields drop their line', () => {
    expect(renderLabel(card, 'Firewall', undefined)).toEqual([
      { text: 'FW01', mono: false },
      { text: '10.0.0.1', mono: true },
    ])
    expect(renderLabel({ hostname: 'SW' }, 'Switch', '{hostname}\n{mgmtIp}\n{type}')).toEqual([
      { text: 'SW', mono: false },
      { text: 'Switch', mono: false },
    ])
    expect(renderLabel(card, 'Firewall', '{hostname}\n{site}')[1]!.text).toBe('CJ-FV-IDC')
  })
  it('knows its presets', () => {
    expect(presetOf(undefined)).toBe('ip')
    expect(presetOf(DEFAULT_LABEL)).toBe('ip')
    expect(presetOf('{hostname}\n{model}')).toBe('model')
  })
})
