import { describe, expect, it } from 'vitest'
import {
  addDevice,
  addLink,
  addPage,
  deleteDevice,
  deleteLink,
  setNodePosition,
  updateDevice,
} from './commands'
import { createDevice, createInterface, createLink, newId } from './factory'
import { createAppStore } from './store'
import { emptyData, type NtbData } from './types'

const PAGE_ID = newId()

/** Fresh store with one page and two devices (1 RJ45 interface each) on it. */
function makeStore() {
  const store = createAppStore()
  store
    .getState()
    .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
  const devA = createDevice({ type: 'l2_switch', hostname: 'SW-A' })
  devA.interfaces.push(createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }))
  const devB = createDevice({ type: 'server', hostname: 'SRV-B' })
  devB.interfaces.push(createInterface({ name: 'eth0', media: 'rj45', speed: '1G' }))
  store.getState().dispatch(addDevice(devA, PAGE_ID, 0, 0))
  store.getState().dispatch(addDevice(devB, PAGE_ID, 100, 0))
  return { store, devA, devB }
}

describe('store: devices', () => {
  it('adds a device with its view node', () => {
    const { store, devA } = makeStore()
    expect(store.getState().data.devices[devA.id].hostname).toBe('SW-A')
    expect(store.getState().data.pages[PAGE_ID].nodes).toHaveLength(2)
  })

  it('undoes and redoes a device update', () => {
    const { store, devA } = makeStore()
    store.getState().dispatch(updateDevice(devA.id, { hostname: 'RENAMED' }))
    expect(store.getState().data.devices[devA.id].hostname).toBe('RENAMED')
    store.getState().undo()
    expect(store.getState().data.devices[devA.id].hostname).toBe('SW-A')
    store.getState().redo()
    expect(store.getState().data.devices[devA.id].hostname).toBe('RENAMED')
  })

  it('deleting a device cascades to its links and view nodes, undo restores all', () => {
    const { store, devA, devB } = makeStore()
    const link = createLink({
      kind: 'ethernet',
      a: { deviceId: devA.id, interfaceId: devA.interfaces[0].id },
      b: { deviceId: devB.id, interfaceId: devB.interfaces[0].id },
    })
    store.getState().dispatch(addLink(link))
    expect(Object.keys(store.getState().data.links)).toHaveLength(1)

    store.getState().dispatch(deleteDevice(devA.id))
    const after = store.getState().data
    expect(after.devices[devA.id]).toBeUndefined()
    expect(after.links[link.id]).toBeUndefined()
    expect(after.pages[PAGE_ID].nodes.map((n) => n.refId)).toEqual([devB.id])

    store.getState().undo()
    const restored = store.getState().data
    expect(restored.devices[devA.id]).toBeDefined()
    expect(restored.links[link.id]).toBeDefined()
    expect(restored.pages[PAGE_ID].nodes).toHaveLength(2)
  })
})

describe('store: links', () => {
  it('rejects a second link into the same interface', () => {
    const { store, devA, devB } = makeStore()
    const link1 = createLink({
      kind: 'ethernet',
      a: { deviceId: devA.id, interfaceId: devA.interfaces[0].id },
      b: { deviceId: devB.id, interfaceId: devB.interfaces[0].id },
    })
    store.getState().dispatch(addLink(link1))
    const link2 = createLink({
      kind: 'ethernet',
      a: { deviceId: devA.id, interfaceId: devA.interfaces[0].id }, // port taken by link1
      b: { deviceId: devB.id, interfaceId: devB.interfaces[0].id },
    })
    expect(() => store.getState().dispatch(addLink(link2))).toThrow(/already linked/)
  })

  it('undoes and redoes link deletion', () => {
    const { store, devA, devB } = makeStore()
    const link = createLink({
      kind: 'ethernet',
      a: { deviceId: devA.id, interfaceId: devA.interfaces[0].id },
      b: { deviceId: devB.id, interfaceId: devB.interfaces[0].id },
    })
    store.getState().dispatch(addLink(link))
    store.getState().dispatch(deleteLink(link.id))
    expect(store.getState().data.links[link.id]).toBeUndefined()
    store.getState().undo()
    expect(store.getState().data.links[link.id]).toBeDefined()
    store.getState().redo()
    expect(store.getState().data.links[link.id]).toBeUndefined()
  })
})

describe('store: undo/redo stack', () => {
  it('supports more than 100 undo steps', () => {
    const { store, devA } = makeStore()
    const STEPS = 150
    for (let i = 0; i < STEPS; i++) {
      store.getState().dispatch(updateDevice(devA.id, { hostname: `SW-A-${i}` }))
    }
    expect(store.getState().past).toHaveLength(STEPS + 3) // + page + 2 devices from makeStore
    for (let i = 0; i < STEPS; i++) store.getState().undo()
    expect(store.getState().data.devices[devA.id].hostname).toBe('SW-A')
  })

  it('collapses consecutive drags with the same mergeKey into one undo step', () => {
    const { store, devA } = makeStore()
    const key = `drag:${devA.id}`
    store.getState().dispatch(setNodePosition(PAGE_ID, devA.id, 10, 10, key))
    store.getState().dispatch(setNodePosition(PAGE_ID, devA.id, 20, 20, key))
    store.getState().dispatch(setNodePosition(PAGE_ID, devA.id, 30, 30, key))
    expect(store.getState().data.pages[PAGE_ID].nodes[0]).toMatchObject({ x: 30, y: 30 })
    // All three drags collapse into a single undo step.
    store.getState().undo()
    expect(store.getState().data.pages[PAGE_ID].nodes[0]).toMatchObject({ x: 0, y: 0 })
    store.getState().redo()
    expect(store.getState().data.pages[PAGE_ID].nodes[0]).toMatchObject({ x: 30, y: 30 })
  })

  it('a new dispatch after undo clears the redo stack', () => {
    const { store, devA } = makeStore()
    store.getState().dispatch(updateDevice(devA.id, { hostname: 'V1' }))
    store.getState().undo()
    expect(store.getState().future).toHaveLength(1)
    store.getState().dispatch(updateDevice(devA.id, { hostname: 'V2' }))
    expect(store.getState().future).toHaveLength(0)
    store.getState().redo()
    expect(store.getState().data.devices[devA.id].hostname).toBe('V2')
  })
})

describe('store: selection', () => {
  it('selection is UI state and survives undo', () => {
    const { store, devA, devB } = makeStore()
    store.getState().setSelection([devA.id, devB.id])
    store.getState().dispatch(updateDevice(devA.id, { hostname: 'X' }))
    store.getState().undo()
    expect(store.getState().selection).toEqual([devA.id, devB.id])
  })
})

describe('store: empty initial state', () => {
  it('starts with an empty undoable model', () => {
    const data: NtbData = emptyData()
    expect(Object.keys(data.devices)).toHaveLength(0)
    expect(createAppStore().getState().past).toHaveLength(0)
  })
})
