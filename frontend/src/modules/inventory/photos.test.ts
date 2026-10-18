import { describe, expect, it } from 'vitest'
import type { CatalogModel } from './devices'
import { catalogImageUrl, photoModel } from './photos'

const model = (id: string, model: string, front = '', partNumbers: string[] = []): CatalogModel =>
  ({
    id,
    vendor: 'Fortinet',
    family: '',
    model,
    partNumbers,
    aliases: [],
    type: 'firewall',
    uHeight: 1,
    ports: [],
    portCount: 0,
    verified: true,
    source: '',
    notes: '',
    images: {
      front,
      rear: '',
      source: front ? 'https://github.com/netbox-community/x' : '',
      similarTo: '',
    },
    lifecycle: { endOfSale: '', endOfSupport: '', source: '' },
  }) as CatalogModel

describe('product photos (P2-12)', () => {
  const models = [
    model('fortinet-fortigate-100f', 'FortiGate 100F', 'fortinet-fortigate-100f.front.jpg', [
      'FG-100F',
    ]),
    model('fortinet-fortigate-40f', 'FortiGate 40F'),
  ]

  it('finds the model by catalog id, else by model or part number', () => {
    expect(photoModel(models, { catalogId: 'fortinet-fortigate-100f' })?.id).toBe(
      'fortinet-fortigate-100f',
    )
    expect(photoModel(models, { model: 'fg-100f', type: 'firewall' })?.id).toBe(
      'fortinet-fortigate-100f',
    )
    expect(photoModel(models, { partNumber: 'FG-100F' })?.id).toBe('fortinet-fortigate-100f')
  })

  it('a model without photos, or no model, gives nothing', () => {
    expect(photoModel(models, { catalogId: 'fortinet-fortigate-40f' })).toBeNull()
    expect(photoModel(models, { model: 'Unknown 9000' })).toBeNull()
    expect(photoModel(models, {})).toBeNull()
  })

  it('image URLs stay inside the catalog endpoint', () => {
    expect(catalogImageUrl('o1', '../x.jpg')).toBe('/api/orgs/o1/device-catalog/images/..%2Fx.jpg')
  })
})
