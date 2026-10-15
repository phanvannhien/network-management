import { describe, expect, it } from 'vitest'
import { nextHostname } from './hostname'
import { createDeviceFromTemplate } from './createFromTemplate'
import { emptyData } from '../model/types'

describe('catalog: nextHostname', () => {
  it('starts at 01 with zero padding', () => {
    expect(nextHostname(emptyData(), 'l2_switch')).toBe('SW-01')
    expect(nextHostname(emptyData(), 'router')).toBe('RTR-01')
    expect(nextHostname(emptyData(), 'firewall')).toBe('FW-01')
  })

  it('skips existing hostnames', () => {
    const data = emptyData()
    data.devices['a'] = createDeviceFromTemplate('l2_switch', 'SW-01')
    data.devices['b'] = createDeviceFromTemplate('l2_switch', 'SW-02')
    expect(nextHostname(data, 'l2_switch')).toBe('SW-03')
  })

  it('counts per prefix, other types do not interfere', () => {
    const data = emptyData()
    data.devices['a'] = createDeviceFromTemplate('l2_switch', 'SW-01')
    data.devices['b'] = createDeviceFromTemplate('firewall', 'FW-01')
    expect(nextHostname(data, 'l2_switch')).toBe('SW-02')
    expect(nextHostname(data, 'firewall')).toBe('FW-02')
  })

  it('unknown types fall back to a typeId-derived prefix', () => {
    expect(nextHostname(emptyData(), 'zone')).toBe('ZON-01')
  })
})
