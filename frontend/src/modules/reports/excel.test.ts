import { describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { detectColumns, ipamRows } from '@/modules/ipam/ipamImport'
import { boqSheets, ipPlanSheets, portMapSheets, sheetName } from './excel'
import type { BoqLine, IpPlanRow, PortMapDevice } from './reports'

const t = i18n.getFixedT('vi')
const asSheet = (rows: (string | number)[][]) => ({
  name: 'x',
  rows: rows.map((r) => r.map(String)),
})

const subnet: IpPlanRow = {
  id: 's1',
  siteCode: 'ORG-HN01',
  siteName: 'Hà Nội',
  cidr: '10.1.20.0/24',
  mask: '255.255.255.0',
  vrf: '',
  gateway: '10.1.20.1',
  description: 'Camera',
  vlanVid: 20,
  vlanName: 'Camera',
  size: 254,
  used: 64,
  ranges: [
    { kind: 'dhcp', startIp: '10.1.20.100', endIp: '10.1.20.200', purpose: '' },
    { kind: 'static', startIp: '10.1.20.10', endIp: '10.1.20.49', purpose: 'NVR' },
  ],
}

describe('report workbooks (P2-11)', () => {
  it('the IP plan sheet reads back through the IPAM import (same columns, DHCP pool kept)', () => {
    const [plan, ranges] = ipPlanSheets([subnet], t)
    const sheet = asSheet(plan!.rows)
    const found = detectColumns(sheet)!
    expect(found).not.toBeNull()
    const [row] = ipamRows(sheet, found.header, found.columns, found.impliedKind)
    expect(row!.row).toMatchObject({
      site: 'ORG-HN01',
      vlan: 20,
      vlanName: 'Camera',
      cidr: '10.1.20.0/24',
      gateway: '10.1.20.1',
      rangeStart: '10.1.20.100',
      rangeEnd: '10.1.20.200',
      rangeKind: 'dhcp',
    })
    expect(plan!.rows[1]).toContain(25) // 64 of 254 used
    // The range sheet is the import template's shape: one row per range, its kind in words.
    const rs = asSheet(ranges!.rows)
    const rf = detectColumns(rs)!
    const back = ipamRows(rs, rf.header, rf.columns, rf.impliedKind).map((r) => r.row)
    expect(back[1]).toMatchObject({
      cidr: '10.1.20.0/24',
      rangeStart: '10.1.20.10',
      rangeKind: 'IP tĩnh',
      purpose: 'NVR',
    })
  })

  it('BOQ: planned and in use on separate sheets, one column per site, a total', () => {
    const lines: BoqLine[] = [
      {
        lifecycle: 'active',
        vendor: 'Cisco',
        model: 'C9200L',
        partNumber: 'C9200L-24P-4G-E',
        type: 'poe_switch',
        quantity: 3,
        clustered: 2,
        sites: [
          { siteCode: 'HN01', quantity: 2 },
          { siteCode: 'HCM01', quantity: 1 },
        ],
      },
      {
        lifecycle: 'planned',
        vendor: 'Cisco',
        model: 'C9200L',
        partNumber: 'C9200L-24P-4G-E',
        type: 'poe_switch',
        quantity: 1,
        clustered: 0,
        sites: [{ siteCode: 'HN01', quantity: 1 }],
      },
    ]
    const sheets = boqSheets(lines, t)
    expect(sheets.map((s) => s.name)).toEqual(['Dự kiến', 'Đang dùng'])
    const active = sheets[1]!.rows
    expect(active[0]).toEqual(expect.arrayContaining(['HCM01', 'HN01']))
    expect(active[1]).toEqual(expect.arrayContaining([3, 'Switch PoE', '2 thuộc stack / cụm HA']))
    expect(active.at(-1)).toEqual(['', '', '', '', 'Tổng', 3])
  })

  it('port map: an "all ports" sheet, then a sheet per switch (not per PC), free ports included', () => {
    const port = (name: string, peer = '') => ({
      id: name,
      name,
      kind: 'physical',
      description: '',
      adminUp: true,
      mode: 'access',
      accessVlan: 20,
      nativeVlan: null,
      allowedVlans: '',
      speed: '1G',
      duplex: 'auto',
      media: 'RJ45',
      poe: true,
      lag: '',
      peerKind: peer ? 'device' : '',
      peerName: peer,
      peerPort: peer ? 'e0' : '',
      cableId: '',
      linkKind: peer ? 'ethernet' : '',
      linkStatus: peer ? 'up' : '',
    })
    const devices: PortMapDevice[] = [
      {
        id: 'd1',
        hostname: 'HN-SW1',
        type: 'poe_switch',
        vendor: 'Cisco',
        model: 'C9200L',
        siteCode: 'HN01',
        clusterName: '',
        ports: [port('Gi1/0/1', 'CAM-01'), port('Gi1/0/2')],
      },
      {
        id: 'd2',
        hostname: 'CAM-01',
        type: 'ip_camera',
        vendor: '',
        model: '',
        siteCode: 'HN01',
        clusterName: '',
        ports: [port('e0', 'HN-SW1')],
      },
    ]
    const sheets = portMapSheets(devices, t)
    expect(sheets.map((s) => s.name)).toEqual(['Tất cả cổng', 'HN-SW1'])
    expect(sheets[0]!.rows).toHaveLength(4)
    expect(sheets[1]!.rows[0]).toEqual(['HN-SW1 C9200L', 'Đã nối 1 / 2 cổng'])
    expect(sheets[1]!.rows.slice(2).map((r) => r[0])).toEqual(['Gi1/0/1', 'Gi1/0/2'])
  })

  it('sheet names follow Excel rules and stay unique', () => {
    const taken = new Set<string>()
    expect(sheetName('CORE/SW:01', taken)).toBe('CORE-SW-01')
    expect(sheetName('core/sw:01', taken)).toBe('core-sw-01~2')
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31)
  })
})
