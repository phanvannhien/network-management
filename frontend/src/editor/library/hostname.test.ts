import { describe, expect, it } from 'vitest'
import { hostnameProblem, hostnameWarning, siteTag, suggestHostname } from './hostname'
import { decodeItem, encodeItem } from './items'
import { matches } from './search'

const BD = { code: 'VPM-AGRI-BD01', localCode: 'BD01' }

describe('hostname suggestion (P1-15)', () => {
  it('uses the site code without the organization code, a type prefix and the next number', () => {
    expect(siteTag(BD)).toBe('AGRI-BD01')
    expect(siteTag({ code: 'VPM-HN01', localCode: 'HN01' })).toBe('HN01')
    expect(suggestHostname(BD, 'firewall', [])).toBe('AGRI-BD01-FW01')
    // Highest + 1, case-insensitive; other sites, types and suffixes do not count.
    expect(
      suggestHostname(BD, 'poe_switch', [
        'agri-bd01-sw01',
        'AGRI-BD01-SW07',
        'AGRI-BD02-SW09',
        'AGRI-BD01-SW03-OLD',
        'AGRI-BD01-CORE05',
      ]),
    ).toBe('AGRI-BD01-SW08')
    expect(suggestHostname(BD, 'l3_switch', ['AGRI-BD01-CORE01'])).toBe('AGRI-BD01-CORE02')
  })

  it('checks DNS label rules and warns about long Windows names', () => {
    expect(hostnameProblem('AGRI-BD01-FW01')).toBeNull()
    expect(hostnameProblem('Máy chủ')).toBe('chars')
    expect(hostnameProblem('FW_01')).toBe('chars')
    expect(hostnameProblem('-FW01')).toBe('dash')
    expect(hostnameProblem('A'.repeat(64))).toBe('length')
    expect(hostnameWarning('AGRI-BD01-SRV01', 'server')).toBeNull()
    expect(hostnameWarning('AGRI-NM-BD01-SRV01', 'server')).toBe('netbios')
    expect(hostnameWarning('AGRI-NM-BD01-FW01', 'firewall')).toBeNull()
  })
})

describe('library items and search (P1-15)', () => {
  it('round-trips drag data and rejects foreign data', () => {
    const item = { kind: 'template', templateId: 't1', type: 'firewall' } as const
    expect(decodeItem(encodeItem(item))).toEqual(item)
    const dev = {
      kind: 'device',
      device: { id: 'd1', hostname: 'FW01', type: 'firewall', siteId: 's1' },
    } as const
    expect(decodeItem(encodeItem(dev))).toEqual(dev)
    expect(decodeItem('{"kind":"device","device":{"id":"d1"}}')).toBeNull()
    expect(decodeItem('not json')).toBeNull()
  })
  it('search ignores accents and word order', () => {
    expect(matches('may chu', 'Máy chủ vật lý')).toBe(true)
    expect(matches('PoE switch', 'Switch PoE', 'Cấp nguồn')).toBe(true)
    expect(matches('dien', 'Điện thoại IP')).toBe(true)
    expect(matches('router', 'Switch')).toBe(false)
  })
})
