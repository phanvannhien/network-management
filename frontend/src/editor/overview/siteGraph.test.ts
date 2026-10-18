import { describe, expect, it } from 'vitest'
import { overviewView, placeMissing, suggestHubs, type SiteCard } from './siteGraph'

const site = (id: string, extra: Partial<SiteCard> = {}): SiteCard => ({
  id,
  code: `ORG-${id}`,
  localCode: id,
  name: id,
  kind: 'office',
  categoryPath: '',
  devices: 1,
  planned: 0,
  groups: 0,
  gateway: '',
  wan: [],
  diagrams: [],
  peers: 0,
  ...extra,
})

describe('overview (P2-21)', () => {
  it('suggests the most connected site as hub, a datacenter next, nothing when no site stands out', () => {
    expect(
      suggestHubs([site('A', { peers: 1 }), site('HQ', { peers: 5 }), site('B', { peers: 1 })]),
    ).toEqual(['HQ'])
    expect(suggestHubs([site('A'), site('IDC', { kind: 'datacenter' })])).toEqual(['IDC'])
    expect(suggestHubs([site('A'), site('B')])).toEqual([])
    // A head office and an IDC both peering widely: two hubs.
    expect(
      suggestHubs([
        site('HO', { peers: 6 }),
        site('IDC', { peers: 4, kind: 'datacenter' }),
        site('C', { peers: 1 }),
      ]),
    ).toEqual(['HO', 'IDC'])
  })

  it('lays out the hubs on top and one frame per category with the other sites in a grid', () => {
    let n = 0
    const v = overviewView(
      {
        sites: [
          site('HQ'),
          site('A', { categoryPath: 'Food' }),
          site('B', { categoryPath: 'Food' }),
          site('C', { categoryPath: 'Agri' }),
        ],
        edges: [],
        segments: [],
      },
      ['HQ'],
      true,
      () => `id${n++}`,
    )
    expect(v.nodes.map((x) => x.refId).sort()).toEqual(['A', 'B', 'C', 'HQ'])
    expect(v.nodes.every((x) => x.refKind === 'site')).toBe(true)
    expect(v.annotations.map((a) => a.text)).toEqual(['Agri', 'Food'])
    const hq = v.nodes.find((x) => x.refId === 'HQ')!
    expect(v.nodes.filter((x) => x.refId !== 'HQ').every((x) => x.y > hq.y)).toBe(true)
  })

  it('places missing sites under what is drawn, without moving anything', () => {
    const out = placeMissing(
      {
        nodes: [
          { x: 100, y: 0 },
          { x: 400, y: 200 },
        ],
      },
      ['X', 'Y'],
    )
    expect(out[0]).toMatchObject({ id: 'X', x: 100 })
    expect(out[0]!.y).toBeGreaterThan(200)
    expect(out[1]!.x).toBeGreaterThan(out[0]!.x)
  })
})
