import { describe, expect, it } from 'vitest'
import {
  addDevice,
  addLink,
  addPage,
  buildPasteCommand,
  compound,
  deleteDevices,
  setNodeLocked,
} from './commands'
import { createDevice, createInterface, createLink, newId } from './factory'
import { createAppStore } from './store'

const PAGE_ID = newId()

function makeStoreWithTwoSwitches() {
  const store = createAppStore()
  store
    .getState()
    .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
  const devices = ['SW-01', 'SW-02'].map((hostname) => {
    const device = createDevice({ type: 'l2_switch', hostname })
    device.interfaces.push(createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }))
    device.interfaces.push(createInterface({ name: 'Gi1/0/2', media: 'rj45', speed: '1G' }))
    return device
  })
  store.getState().dispatch(addDevice(devices[0], PAGE_ID, 0, 0))
  store.getState().dispatch(addDevice(devices[1], PAGE_ID, 200, 0))
  const link = createLink({
    kind: 'ethernet',
    a: { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
    b: { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
  })
  store.getState().dispatch(addLink(link))
  return { store, devices, link }
}

describe('model: deleteDevices', () => {
  it('deletes several devices in one undo step', () => {
    const { store } = makeStoreWithTwoSwitches()
    const ids =
      store.getState().selection.length === 0 ? Object.keys(store.getState().data.devices) : []
    store.getState().dispatch(deleteDevices(ids))
    expect(Object.keys(store.getState().data.devices)).toHaveLength(0)
    store.getState().undo()
    expect(Object.keys(store.getState().data.devices)).toHaveLength(2)
  })
})

describe('model: buildPasteCommand', () => {
  it('paste renames conflicting hostnames and keeps internal links', () => {
    const { store, devices, link } = makeStoreWithTwoSwitches()
    const { command, newDeviceIds } = buildPasteCommand(
      store.getState().data,
      PAGE_ID,
      devices.map((d) => d.id),
      40,
      40,
    )
    store.getState().dispatch(command)

    const after = store.getState().data
    expect(Object.keys(after.devices)).toHaveLength(4)
    const newHostnames = newDeviceIds.map((id) => after.devices[id].hostname)
    expect(newHostnames).toEqual(['SW-03', 'SW-04'])

    // Interfaces copied with fresh ids but same names.
    const copy = after.devices[newDeviceIds[0]]
    expect(copy.interfaces.map((i) => i.name)).toEqual(['Gi1/0/1', 'Gi1/0/2'])
    expect(copy.interfaces.every((i) => !devices[0].interfaces.some((o) => o.id === i.id))).toBe(
      true,
    )

    // Internal link copied with remapped endpoints.
    expect(Object.keys(after.links)).toHaveLength(2)
    const copiedLink = Object.values(after.links).find((l) => l.id !== link.id)!
    expect(copiedLink.a.deviceId).toBe(newDeviceIds[0])
    expect(copiedLink.b.deviceId).toBe(newDeviceIds[1])

    // Node positions offset by (40, 40).
    const node = after.pages[PAGE_ID].nodes.find((n) => n.refId === newDeviceIds[0])!
    expect(node).toMatchObject({ x: 40, y: 40 })
  })

  it('paste is a single undo step', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    const before = store.getState().past.length
    const { command } = buildPasteCommand(
      store.getState().data,
      PAGE_ID,
      devices.map((d) => d.id),
      10,
      10,
    )
    store.getState().dispatch(command)
    expect(store.getState().past.length).toBe(before + 1)
    store.getState().undo()
    expect(Object.keys(store.getState().data.devices)).toHaveLength(2)
    expect(Object.keys(store.getState().data.links)).toHaveLength(1)
  })
})

describe('model: setNodeLocked', () => {
  it('locks a node; adapter reports it as not draggable', async () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    store.getState().dispatch(setNodeLocked(PAGE_ID, devices[0].id, true))
    const node = store.getState().data.pages[PAGE_ID].nodes.find((n) => n.refId === devices[0].id)!
    expect(node.locked).toBe(true)
    const { buildNodes } = await import('../canvas/adapters')
    const rfNodes = buildNodes(store.getState().data, PAGE_ID)
    expect(rfNodes.find((n) => n.id === devices[0].id)?.draggable).toBe(false)
    expect(rfNodes.find((n) => n.id === devices[1].id)?.draggable).toBe(true)
  })
})

describe('model: compound', () => {
  it('applies all sub-commands atomically', () => {
    const store = createAppStore()
    const pageA = newId()
    store
      .getState()
      .dispatch(
        compound(
          addPage({ id: pageA, name: 'A', layer: 'physical', nodes: [], edges: [] }),
          addDevice(createDevice({ type: 'pc', hostname: 'PC-01' }), pageA, 0, 0),
        ),
      )
    expect(Object.keys(store.getState().data.devices)).toHaveLength(1)
    expect(store.getState().past).toHaveLength(1)
  })
})

describe('store: clipboard', () => {
  it('clipboard is UI state — dispatching does not touch it', () => {
    const { store } = makeStoreWithTwoSwitches()
    store.getState().setClipboard(['x'])
    store.getState().dispatch(deleteDevices(Object.keys(store.getState().data.devices)))
    expect(store.getState().clipboard).toEqual(['x'])
  })
})
