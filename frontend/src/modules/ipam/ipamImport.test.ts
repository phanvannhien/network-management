import { describe, expect, it } from 'vitest'
import { detectColumns, fieldOf, fullRange, ipamRows, withMask } from './ipamImport'

// P2-09: reading an IP plan spreadsheet.

describe('IPAM import columns', () => {
  it('recognises Vietnamese and English headers, any case / diacritics', () => {
    expect(fieldOf('Chi nhánh')).toBe('site')
    expect(fieldOf('VLAN ID')).toBe('vlan')
    expect(fieldOf('Tên VLAN')).toBe('vlanName')
    expect(fieldOf('Dải mạng')).toBe('cidr')
    expect(fieldOf('Gateway')).toBe('gateway')
    expect(fieldOf('IP đầu')).toBe('rangeStart')
    expect(fieldOf('Range End')).toBe('rangeEnd')
    expect(fieldOf('Loại dải')).toBe('rangeKind')
    expect(fieldOf('Mục đích')).toBe('purpose')
    expect(fieldOf('Số điện thoại')).toBeNull()
  })

  it('finds the header under a title, reads rows, splits a range column, skips blanks', () => {
    const sheet = {
      name: 'IP plan',
      rows: [
        ['QUY HOẠCH IP — CÔNG TY A', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['Site', 'VLAN', 'Tên VLAN', 'Subnet', 'Gateway', 'Dải IP', 'Loại'],
        ['HCM01', '20', 'Camera', '10.1.20.0/24', '10.1.20.1', '10.1.20.100 - 10.1.20.200', 'DHCP'],
        ['', '', '', '', '', '', ''],
        ['HCM01', '99', 'MGMT', '', '', '', ''],
        ['Ghi chú: hết', '', '', '', '', '', ''],
      ],
    }
    const found = detectColumns(sheet)!
    expect(found.header).toBe(2)
    const rows = ipamRows(sheet, found.header, found.columns)
    expect(rows.map((r) => r.line)).toEqual([4, 6])
    expect(rows[0]!.row).toMatchObject({
      site: 'HCM01',
      vlan: 20,
      vlanName: 'Camera',
      cidr: '10.1.20.0/24',
      gateway: '10.1.20.1',
      rangeStart: '10.1.20.100',
      rangeEnd: '10.1.20.200',
      rangeKind: 'DHCP',
    })
    expect(rows[1]!.row).toMatchObject({ vlan: 99, vlanName: 'MGMT', cidr: '' })
  })

  it('says when no column looks like a subnet', () => {
    expect(detectColumns({ name: 'x', rows: [['Hostname', 'IP']] })).toBeNull()
  })
})

describe('IPAM import cells', () => {
  it('joins a network with its mask, reads short ranges and VLAN cells', () => {
    expect(withMask('10.1.20.0', '255.255.255.0')).toBe('10.1.20.0/24')
    expect(withMask('10.1.20.0', '/23')).toBe('10.1.20.0/23')
    expect(withMask('10.1.20.0/24', '255.255.0.0')).toBe('10.1.20.0/24')
    expect(withMask('10.1.20.0', '255.0.255.0')).toBe('10.1.20.0')
    expect(fullRange('.100', '.200', '10.1.20.0/24')).toEqual(['10.1.20.100', '10.1.20.200'])
    expect(fullRange('10.1.30.10', '50', '')).toEqual(['10.1.30.10', '10.1.30.50'])
    const sheet = {
      name: 'x',
      rows: [
        ['Mạng', 'Subnet mask', 'VLAN', 'Dải'],
        ['10.1.20.0', '255.255.255.0', 'VLAN 20 - Camera', '.100-.200'],
      ],
    }
    const f = detectColumns(sheet)!
    expect(ipamRows(sheet, f.header, f.columns)[0]!.row).toMatchObject({
      cidr: '10.1.20.0/24',
      vlan: 20,
      vlanName: 'Camera',
      rangeStart: '10.1.20.100',
      rangeEnd: '10.1.20.200',
    })
  })
})

describe('IPAM import, review cases', () => {
  it('a "DHCP pool" column without a kind column is DHCP; odd VLAN cells; a title row is not a header', () => {
    const sheet = {
      name: 'x',
      rows: [
        ['Network plan 2026'],
        ['Subnet', 'VLAN', 'DHCP pool'],
        ['10.5.1.0/24', 'Vlan 10 Data', '10.5.1.100-10.5.1.200'],
        ['10.5.2.0/24', 'VLAN20 (Cam)', ''],
        ['10.5.3.0/24', '10.0', ''],
        ['10.5.4.0/24', 'Kho', ''],
      ],
    }
    const f = detectColumns(sheet)!
    expect(f.header).toBe(1)
    const rows = ipamRows(sheet, f.header, f.columns, f.dhcpRange)
    expect(rows[0]!.row).toMatchObject({
      vlan: 10,
      vlanName: 'Data',
      rangeKind: 'dhcp',
      rangeStart: '10.5.1.100',
    })
    expect(rows[1]!.row).toMatchObject({ vlan: 20, vlanName: 'Cam', rangeKind: '' })
    expect(rows[2]!.row.vlan).toBe(10)
    expect(rows[3]).toMatchObject({ note: 'Kho', row: { vlan: null } })
  })
})
