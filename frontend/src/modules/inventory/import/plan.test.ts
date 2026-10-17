import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readWorkbook } from './parse'
import {
  autoMap,
  buildPlan,
  dataRows,
  detectHeader,
  fileProblems,
  inferProduct,
  matchCatalog,
  matchSite,
  placeKey,
  proposeClusters,
  siteKeyOf,
  suggestSiteCode,
  toImportRow,
  typeFromText,
  type SiteLike,
} from './plan'

// The customer's sheet (docs/demo/devices.png): a "Person in charge" line above the table, Site = company,
// Location = place, Category = kind of device, credentials at the end.
const SHEET = [
  ['', '', '', '', 'Person in charge', 'GVN'],
  [
    'No',
    'Site',
    'Location',
    'Category',
    'Hostname',
    'Ip Address mgmt',
    'PartNumber',
    'S/N',
    'User name',
    'Password',
  ],
  [
    '1',
    'CJ FOODVILLE',
    'FPT IDC HCM',
    'Firewall',
    'VPN_CJIDC',
    '10.136.4.101',
    'FortiGate 80F',
    'FGT80FTK22027891',
    'GVN',
    'x1',
  ],
  [
    '2',
    '',
    'FPT IDC HCM',
    'Firewall',
    'CJIDC_HA_Slaver',
    '10.136.4.101',
    'FortiGate 80F',
    'FGT80FTK22027966',
    'GVN',
    'x1',
  ],
  [
    '3',
    '',
    'HaNoi',
    'Router',
    'ISR4331_VN_FV_HanoiOffice_41.1',
    '10.136.41.1',
    'ISR4331/K9',
    'FDO2623M1CH',
    'gvn',
    'x2',
  ],
  [
    '4',
    '',
    'HaNoi',
    'Switch',
    'CSB220_VN_FV_HanoiOffice_41.2',
    '10.136.41.2',
    'CBS220-24T-4G',
    'DNI2551013J',
    'gvn',
    'x3',
  ],
  [
    '5',
    '',
    'Hochiminh',
    'Switch',
    'c1300-vn-foodville-hcm-162-4',
    '10.136.162.4',
    'C1300-24T-4G',
    'DNI284102TL',
    'gvn',
    'x4',
  ],
  [],
  ['Ghi chú cuối bảng'],
]

function workbook(): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(SHEET)
  // "CJ FOODVILLE" written once, merged down rows 3–7 (as customers do).
  ws['!merges'] = [{ s: { r: 2, c: 1 }, e: { r: 6, c: 1 } }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Devices')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const SITES: SiteLike[] = [
  {
    id: 'idc',
    code: 'CJ-FOODVILLE-HCM01',
    localCode: 'HCM01',
    name: 'FPT IDC HCM',
    categoryId: 'fv',
  },
  {
    id: 'han',
    code: 'CJ-FOODVILLE-HAN01',
    localCode: 'HAN01',
    name: 'Văn phòng Hà Nội',
    categoryId: 'fv',
  },
  {
    id: 'hoc',
    code: 'CJ-FOODVILLE-HOC01',
    localCode: 'HOC01',
    name: 'Văn phòng Hồ Chí Minh (HQ)',
    categoryId: 'fv',
  },
  { id: 'other', code: 'AGRI-HN01', localCode: 'HN01', name: 'Hà Nội', categoryId: 'agri' },
]

describe('reading the customer sheet', () => {
  const sheet = readWorkbook(workbook())[0]!
  const header = detectHeader(sheet.rows)!

  it('finds the header under the "Person in charge" line and keeps that value', () => {
    expect(header.index).toBe(1)
    expect(header.meta).toEqual({ owner: 'GVN' })
  })

  it('maps Site → category, Location → site, Category → type; credentials are never mapped', () => {
    expect(autoMap(header.headers)).toEqual([
      'ignore',
      'category',
      'site',
      'type',
      'hostname',
      'mgmtIp',
      'partNumber',
      'serial',
      'secret',
      'secret',
    ])
  })

  it('fills merged cells and stops at the first blank row', () => {
    const rows = dataRows(sheet.rows, header)
    expect(rows.map((r) => r.line)).toEqual([3, 4, 5, 6, 7])
    expect(rows.every((r) => r.cells[1] === 'CJ FOODVILLE')).toBe(true)
  })

  it('plans devices: product, type, site, template; HA pair proposed from the shared IP', () => {
    const rows = dataRows(sheet.rows, header)
    const sites = {
      [siteKeyOf('CJ FOODVILLE', 'FPT IDC HCM')]: 'idc',
      [siteKeyOf('CJ FOODVILLE', 'HaNoi')]: 'han',
      [siteKeyOf('CJ FOODVILLE', 'Hochiminh')]: 'hoc',
    }
    const templates = [{ id: 't-isr', partNumber: 'ISR4331/K9', model: 'ISR4331', type: 'router' }]
    const plan = buildPlan(
      rows,
      autoMap(header.headers),
      header.meta,
      { types: {}, sites },
      templates,
    )
    expect(plan.map((p) => [p.hostname, p.type, p.siteId, p.vendor, p.model, p.owner])).toEqual([
      ['VPN_CJIDC', 'firewall', 'idc', 'Fortinet', 'FortiGate 80F', 'GVN'],
      ['CJIDC_HA_Slaver', 'firewall', 'idc', 'Fortinet', 'FortiGate 80F', 'GVN'],
      ['ISR4331_VN_FV_HanoiOffice_41.1', 'router', 'han', 'Cisco', 'ISR4331', 'GVN'],
      ['CSB220_VN_FV_HanoiOffice_41.2', 'l2_switch', 'han', 'Cisco', 'CBS220-24T-4G', 'GVN'],
      ['c1300-vn-foodville-hcm-162-4', 'l2_switch', 'hoc', 'Cisco', 'C1300-24T-4G', 'GVN'],
    ])
    expect(plan[2]!.templateId).toBe('t-isr')
    expect(plan.every((p) => p.problems.length === 0)).toBe(true)
    // Nothing of the credential columns is in the plan or in what goes to the API.
    expect(JSON.stringify(plan)).not.toMatch(/x1|x2|x3|x4/)
    const clusters = proposeClusters(plan)
    expect(clusters).toEqual([
      expect.objectContaining({
        kind: 'ha_active_passive',
        ip: '10.136.4.101',
        siteId: 'idc',
        lines: [3, 4],
      }),
    ])
    expect(fileProblems(plan, clusters).size).toBe(0)
    const body = toImportRow(plan[1]!, clusters[0])
    expect(body).toMatchObject({
      row: 4,
      clusterKey: 'c1',
      device: { clusterRole: 'secondary', clusterMemberNo: 2, hostname: 'CJIDC_HA_Slaver' },
    })
    expect(JSON.stringify(body)).not.toMatch(/x1/)
  })
})

describe('values', () => {
  it('device kinds', () => {
    expect(typeFromText('Firewall')).toBe('firewall')
    expect(typeFromText('Switch', 'C1300-24FP-4G')).toBe('poe_switch')
    expect(typeFromText('Core switch')).toBe('l3_switch')
    expect(typeFromText('Tường lửa')).toBe('firewall')
    expect(typeFromText('Something')).toBeNull()
  })
  it('products', () => {
    expect(inferProduct('FG-80F')).toEqual({
      vendor: 'Fortinet',
      model: 'FortiGate 80F',
      partNumber: 'FG-80F',
    })
    expect(inferProduct('ISR4331/K9')).toEqual({
      vendor: 'Cisco',
      model: 'ISR4331',
      partNumber: 'ISR4331/K9',
    })
    expect(inferProduct('XYZ-1')).toEqual({ vendor: '', model: 'XYZ-1', partNumber: 'XYZ-1' })
  })
  it('places: exact is automatic, aliases are proposals inside the company first', () => {
    expect(placeKey('Ho Chi Minh')).toBe('hcm')
    expect(placeKey('TP.HCM')).toBe('hcm')
    expect(matchSite('FPT IDC HCM', 'fv', SITES)).toEqual({
      kind: 'exact',
      siteId: 'idc',
      candidates: ['idc'],
    })
    const hn = matchSite('HaNoi', 'fv', SITES)
    expect(hn.kind).toBe('proposal')
    expect(hn.siteId).toBe('han')
    const hcm = matchSite('Hochiminh', 'fv', SITES)
    expect(hcm.kind).toBe('proposal')
    expect(hcm.candidates).toContain('hoc')
    // The HQ office, not the IDC whose name also says HCM.
    expect(hcm.siteId).toBe('hoc')
    expect(matchSite('Đà Lạt', 'fv', SITES).kind).toBe('none')
  })
  it('site codes for new sites', () => {
    expect(suggestSiteCode('Hochiminh', new Set())).toBe('HCM01')
    expect(suggestSiteCode('Ha Noi', new Set(['HN01']))).toBe('HN02')
    expect(suggestSiteCode('Nhà máy Bình Định', new Set())).toBe('NMBD01')
  })
  it('in-file duplicates: hostname, serial, IP outside a cluster', () => {
    const r = (line: number, hostname: string, serial: string, mgmtIp: string) =>
      ({ line, hostname, serial, mgmtIp, siteId: 's', type: 'router', model: '' }) as Parameters<
        typeof fileProblems
      >[0][number]
    const problems = fileProblems(
      [r(1, 'A', 'S1', '10.0.0.1'), r(2, 'a', 's1', '10.0.0.1'), r(3, 'B', 'N/A', '')],
      [],
    )
    expect(problems.get(2)).toEqual([
      'Hostname trùng dòng 1',
      'S/N trùng dòng 1',
      'IP trùng dòng 1 (không cùng cụm)',
    ])
    expect(problems.has(3)).toBe(false)
  })
})

describe('catalog match (ADR-035)', () => {
  const models = [
    {
      id: 'c1300',
      model: 'C1300-24T-4G',
      partNumbers: ['C1300-24T-4G'],
      aliases: [],
      type: 'l2_switch',
    },
    {
      id: 'fg80f',
      model: 'FortiGate 80F',
      partNumbers: ['FG-80F'],
      aliases: ['FGT-80F'],
      type: 'firewall',
    },
    { id: 'isr', model: 'ISR4331', partNumbers: ['ISR4331/K9'], aliases: [], type: 'router' },
  ]
  it('matches model, part number or alias ignoring case and punctuation', () => {
    expect(matchCatalog(models, ['c1300-24t-4g'])?.id).toBe('c1300')
    expect(matchCatalog(models, ['fg80f'])?.id).toBe('fg80f')
    expect(matchCatalog(models, ['', 'FGT 80F'])?.id).toBe('fg80f')
    expect(matchCatalog(models, ['ISR4331/K9', 'ISR4331'])?.id).toBe('isr')
    expect(matchCatalog(models, ['C1300-24P-4G'])).toBeUndefined()
  })
})
