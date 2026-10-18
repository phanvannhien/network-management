import { describe, expect, it } from 'vitest'
import {
  carries,
  classifyL2,
  formatVlanSet,
  namedVids,
  parseVlanList,
  vlanInfo,
  vlanSetHas,
  vlanSetMinus,
  type PortL2,
} from './l2'

const port = (p: Partial<PortL2>): PortL2 => ({
  mode: '',
  access: null,
  native: null,
  allowed: '',
  lagId: null,
  lagName: '',
  ...p,
})

describe('VLAN lists', () => {
  it('parses, merges and formats ranges', () => {
    expect(parseVlanList('')).toBe('all')
    expect(parseVlanList('30-35,10,20,21,36')).toEqual([
      [10, 10],
      [20, 21],
      [30, 36],
    ])
    expect(formatVlanSet(parseVlanList('30-35,10,20,21'))).toBe('10,20,21,30–35')
    expect(formatVlanSet('all')).toBe('ALL')
    expect(vlanSetHas(parseVlanList('10,30-35'), 33)).toBe(true)
    expect(vlanSetHas(parseVlanList('10,30-35'), 20)).toBe(false)
    expect(vlanSetHas('all', 4094)).toBe(true)
  })

  it('subtracts one list from another', () => {
    expect(vlanSetMinus([[10, 40]], [[20, 30]])).toEqual([
      [10, 19],
      [31, 40],
    ])
    expect(vlanSetMinus([[10, 10]], [[1, 4094]])).toEqual([])
  })
})

describe('classifyL2', () => {
  it('colours an access cable by its VLAN, whatever the other end is', () => {
    const e = classifyL2(port({ mode: 'access', access: 20 }), port({}))
    expect(e.kind).toBe('access')
    expect(carries(e, 20)).toBe('yes')
    expect(carries(e, 30)).toBe('no')
    expect(classifyL2(port({ mode: 'access' }), undefined)).toMatchObject({
      kind: 'access',
      noVlan: true,
    })
    // A routed firewall port on an access port: the switch side decides.
    expect(classifyL2(port({ mode: 'routed' }), port({ mode: 'access', access: 20 })).kind).toBe(
      'access',
    )
  })

  it('reads a trunk: allowed list (empty = all) and a non-default native VLAN', () => {
    const e = classifyL2(
      port({ mode: 'trunk', allowed: '20,99', native: 99 }),
      port({ mode: 'trunk', allowed: '20,99', native: 99 }),
    )
    expect(e).toMatchObject({ kind: 'trunk', native: 99, issues: [], unspecified: false })
    expect(carries(e, 99)).toBe('yes')
    expect(carries(e, 30)).toBe('no')
    // Nothing filled in: vendors differ (all / VLAN 1 / native only), so "maybe", shown as ALL?.
    const open = classifyL2(port({ mode: 'trunk' }), undefined)
    expect(open).toMatchObject({ vlans: 'all', unspecified: true, native: null })
    expect(carries(open, 1234)).toBe('maybe')
    expect(carries(open, 1)).toBe('yes')
    expect(parseVlanList('1-4094')).toBe('all')
  })

  it('carries a VLAN only when both switchports let it through', () => {
    const half = classifyL2(
      port({ mode: 'trunk', allowed: '10,20,30' }),
      port({ mode: 'trunk', allowed: '10,20' }),
    )
    expect(carries(half, 20)).toBe('yes')
    expect(carries(half, 30)).toBe('maybe')
    expect(carries(half, 40)).toBe('no')
    expect(carries(classifyL2(port({ mode: 'routed' }), undefined), 1)).toBe('no')
  })

  it('flags mismatches between two switchports only', () => {
    expect(
      classifyL2(port({ mode: 'access', access: 20 }), port({ mode: 'access', access: 30 })).issues,
    ).toEqual([{ key: 'accessDiffers', level: 'warning', values: { a: 20, b: 30 } }])
    expect(
      classifyL2(
        port({ mode: 'trunk', native: 99 }),
        port({ mode: 'trunk', native: 1 }),
      ).issues.map((i) => i.key),
    ).toEqual(['nativeDiffers'])
    // Not filled in on one side: only worth a look.
    expect(classifyL2(port({ mode: 'trunk', native: 99 }), port({ mode: 'trunk' })).issues).toEqual(
      [{ key: 'nativeOneSide', level: 'info', values: { a: 99, b: 1 } }],
    )
    expect(
      classifyL2(
        port({ mode: 'trunk', allowed: '10,20,30' }),
        port({ mode: 'trunk', allowed: '10,20' }),
      ).issues,
    ).toEqual([{ key: 'allowedOneSide', level: 'info', values: { vlans: '30' } }])
    // "All" against a list is a normal setup.
    expect(
      classifyL2(port({ mode: 'trunk' }), port({ mode: 'trunk', allowed: '10,20' })).issues,
    ).toEqual([])
    // An access port facing a trunk works only for the trunk's native VLAN.
    expect(
      classifyL2(port({ mode: 'access', access: 20 }), port({ mode: 'trunk', native: 20 })).issues,
    ).toEqual([])
    expect(
      classifyL2(port({ mode: 'access', access: 20 }), port({ mode: 'trunk' })).issues,
    ).toEqual([{ key: 'accessToTrunk', level: 'warning', values: { access: 20, native: 1 } }])
    // A camera / router end with nothing filled in is not a mismatch.
    expect(classifyL2(port({ mode: 'access', access: 20 }), port({})).issues).toEqual([])
    expect(classifyL2(undefined, undefined).kind).toBe('unset')
  })

  it('flags a LAG member cable whose other end is a plain port', () => {
    const e = classifyL2(
      port({ mode: 'trunk', lagId: 'po1', lagName: 'Po1' }),
      port({ mode: 'trunk' }),
    )
    expect(e.issues).toEqual([{ key: 'lagOneSide', level: 'warning', values: { lag: 'Po1' } }])
  })
})

describe('VLAN colours and legend', () => {
  const vlans = [
    { vid: 20, name: 'Camera HCM', color: '#16a34a', siteId: 's1' },
    { vid: 20, name: 'Camera', color: '#22c55e', siteId: null },
    { vid: 99, name: 'MGMT', color: '#64748b', siteId: null },
  ]
  it("prefers the site's own VLAN, then the organization-wide one", () => {
    expect(vlanInfo(20, 's1', vlans)).toMatchObject({ name: 'Camera HCM', key: 's1:20' })
    expect(vlanInfo(20, 's2', vlans)).toMatchObject({ name: 'Camera', key: 'org:20' })
    expect(vlanInfo(30, 's1', vlans)).toMatchObject({ unknown: true, name: '', key: '?:30' })
  })
  it('names the VLANs a cable carries explicitly', () => {
    expect(namedVids(classifyL2(port({ mode: 'access', access: 30 }), undefined))).toEqual([30])
    expect(
      namedVids(classifyL2(port({ mode: 'trunk', allowed: '10,20', native: 99 }), undefined)),
    ).toEqual([10, 20, 99])
    expect(namedVids(classifyL2(port({ mode: 'trunk' }), undefined))).toEqual([])
  })
})
