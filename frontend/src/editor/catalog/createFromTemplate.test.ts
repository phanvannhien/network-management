import { describe, expect, it } from 'vitest'
import { DEVICE_TEMPLATES, getTemplate, templatesByGroup } from './catalog'
import { createDeviceFromTemplate } from './createFromTemplate'
import { DEVICE_GROUP_ORDER } from './catalog'

describe('catalog: createDeviceFromTemplate', () => {
  it('L2 switch template generates 24×RJ45 + 4×SFP (SRS §2 example)', () => {
    const device = createDeviceFromTemplate('l2_switch', 'SW-ACC-01')
    expect(device.type).toBe('l2_switch')
    expect(device.hostname).toBe('SW-ACC-01')
    expect(device.interfaces).toHaveLength(28)
    const copper = device.interfaces.slice(0, 24)
    const fiber = device.interfaces.slice(24)
    expect(copper[0].name).toBe('Gi1/0/1')
    expect(copper[23].name).toBe('Gi1/0/24')
    expect(copper.every((i) => i.media === 'rj45' && i.speed === '1G')).toBe(true)
    expect(fiber[0].name).toBe('Gi1/1/1')
    expect(fiber.every((i) => i.media === 'sfp' && i.mode === 'trunk')).toBe(true)
    expect(new Set(device.interfaces.map((i) => i.id)).size).toBe(28) // unique ids
  })

  it('PoE switch template marks copper ports with PoE', () => {
    const device = createDeviceFromTemplate('poe_switch', 'SW-POE-01')
    const copper = device.interfaces.filter((i) => i.media === 'rj45')
    expect(copper).toHaveLength(24)
    expect(copper.every((i) => i.poe)).toBe(true)
    expect(device.interfaces.filter((i) => i.media === 'sfp_plus')).toHaveLength(2)
  })

  it('server template generates named NICs eno1..4 + 2×SFP+', () => {
    const device = createDeviceFromTemplate('server', 'SRV-01')
    expect(device.interfaces.map((i) => i.name).slice(0, 4)).toEqual([
      'eno1',
      'eno2',
      'eno3',
      'eno4',
    ])
    expect(device.interfaces).toHaveLength(6)
    expect(device.interfaces[4].media).toBe('sfp_plus')
  })

  it('end devices get a single port', () => {
    const camera = createDeviceFromTemplate('ip_camera', 'CAM-01')
    expect(camera.interfaces).toHaveLength(1)
    expect(camera.interfaces[0]).toMatchObject({ media: 'rj45', speed: '100M' })
    const phone = createDeviceFromTemplate('ip_phone', 'PH-01')
    expect(phone.interfaces[0].poe).toBe(true)
  })

  it('cloud-like templates have no ports', () => {
    for (const typeId of ['cloud', 'isp', 'mpls_cloud'] as const) {
      expect(createDeviceFromTemplate(typeId, 'X').interfaces).toHaveLength(0)
    }
  })

  it('new devices default to lifecycle "planned"', () => {
    expect(createDeviceFromTemplate('router', 'R-01').lifecycle).toBe('planned')
  })
})

describe('catalog: integrity', () => {
  it('every template has unique type ids', () => {
    const ids = DEVICE_TEMPLATES.map((t) => t.typeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all 5 base groups are non-empty', () => {
    for (const group of DEVICE_GROUP_ORDER) {
      expect(templatesByGroup(group).length).toBeGreaterThan(0)
    }
  })

  it('every generated interface name is prefixed and numbered', () => {
    for (const template of DEVICE_TEMPLATES) {
      const device = createDeviceFromTemplate(template.typeId, 'X')
      for (const iface of device.interfaces) {
        expect(iface.name).toMatch(/\d+$/) // ends with port number
        expect(iface.id).toBeTruthy()
      }
    }
  })

  it('getTemplate throws for unknown types', () => {
    expect(() => getTemplate('nonexistent' as never)).toThrow(/no device template/)
  })
})
