import { describe, expect, it } from 'vitest'
import {
  addDevice,
  addLink,
  addPage,
  updateDevicesBulk,
  updateDevice,
  updateLink,
} from '../model/commands'
import { createDevice, createInterface, createLink, newId } from '../model/factory'
import { createAppStore } from '../model/store'

const PAGE_ID = newId()

function makeStore() {
  const store = createAppStore()
  store
    .getState()
    .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
  const devices = [1, 2].map((n) => {
    const device = createDevice({ type: 'l2_switch', hostname: `SW-${String(n).padStart(2, '0')}` })
    device.interfaces.push(createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }))
    return device
  })
  for (const device of devices) store.getState().dispatch(addDevice(device, PAGE_ID, 0, 0))
  return { store, devices }
}

describe('model: updateDevice / updateDevicesBulk', () => {
  it('updates a single device field', () => {
    const { store, devices } = makeStore()
    store.getState().dispatch(updateDevice(devices[0].id, { site: 'HQ', role: 'access' }))
    const device = store.getState().data.devices[devices[0].id]
    expect(device.site).toBe('HQ')
    expect(device.role).toBe('access')
  })

  it('bulk update touches all selected devices in one undo step', () => {
    const { store } = makeStore()
    const ids = Object.keys(store.getState().data.devices)
    const before = store.getState().past.length
    store.getState().dispatch(updateDevicesBulk(ids, { role: 'distribution', site: 'DC1' }))
    const data = store.getState().data
    for (const id of ids) {
      expect(data.devices[id].role).toBe('distribution')
      expect(data.devices[id].site).toBe('DC1')
    }
    expect(store.getState().past.length).toBe(before + 1)
    store.getState().undo()
    expect(store.getState().data.devices[ids[0]].site).toBeUndefined()
  })
})

describe('model: updateLink', () => {
  it('patches link status/speed/notes without touching endpoints', () => {
    const { store, devices } = makeStore()
    const link = createLink({
      kind: 'ethernet',
      a: { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
      b: { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
    })
    store.getState().dispatch(addLink(link))
    store
      .getState()
      .dispatch(updateLink(link.id, { status: 'up', speed: '1G', notes: 'core uplink' }))
    const saved = store.getState().data.links[link.id]
    expect(saved.status).toBe('up')
    expect(saved.speed).toBe('1G')
    expect(saved.notes).toBe('core uplink')
    expect(saved.a).toEqual(link.a)
  })

  it('throws for unknown link id', () => {
    const { store } = makeStore()
    expect(() => store.getState().dispatch(updateLink(newId(), { notes: 'x' }))).toThrow(
      /not found/,
    )
  })
})
