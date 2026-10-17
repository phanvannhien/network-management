import { describe, expect, it } from 'vitest'
import type { Device } from './devices'
import { deviceRows } from './exportDevices'
import { autoMap, detectHeader, isSecretHeader, typeFromText } from './import/plan'

const device = {
  hostname: 'SW-HN-01',
  type: 'l2_switch',
  categoryPath: 'CJ Group › CJ Foodville',
  siteCode: 'CJ-FOODVILLE-HAN01',
  siteName: 'Văn phòng Hà Nội',
  mgmtIp: '10.136.41.2/24',
  mgmtInterfaceName: 'Vlan1',
  partNumber: 'CBS220-24T-4G',
  model: 'CBS220-24T-4G',
  vendor: 'Cisco',
  serialNumber: 'DNI1',
  ownerName: 'GVN',
  notes: '',
  lifecycle: 'active',
  firmware: '',
  clusterName: '',
} as unknown as Device

describe('device export (P1-22)', () => {
  it('writes what the importer reads back, no credential column', () => {
    const rows = deviceRows([device])
    expect(rows[0]!.some(isSecretHeader)).toBe(false)
    const header = detectHeader(rows)!
    const map = autoMap(header.headers)
    const cell = (f: string) => rows[1]![map.indexOf(f as never)]
    expect(cell('category')).toBe('CJ Foodville')
    expect(cell('site')).toBe('CJ-FOODVILLE-HAN01')
    expect(cell('hostname')).toBe('SW-HN-01')
    expect(cell('mgmtIp')).toBe('10.136.41.2')
    expect(cell('mgmtInterface')).toBe('Vlan1')
    expect(cell('serial')).toBe('DNI1')
    expect(cell('owner')).toBe('GVN')
    expect(typeFromText(cell('type')!)).toBe('l2_switch')
  })
})
