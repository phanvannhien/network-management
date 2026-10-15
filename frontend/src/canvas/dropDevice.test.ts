import { describe, expect, it } from 'vitest'
import { addPage } from '../model/commands'
import { createAppStore } from '../model/store'
import { newId } from '../model/factory'
import { buildNodes } from './adapters'
import { deviceDropCommand } from './dropDevice'

const PAGE_ID = newId()

describe('canvas: deviceDropCommand', () => {
  it('dropping a template creates the device and its node at the drop position', () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    const { data } = store.getState()
    store.getState().dispatch(deviceDropCommand(data, PAGE_ID, 'l2_switch', 150, 90))

    const after = store.getState().data
    const devices = Object.values(after.devices)
    expect(devices).toHaveLength(1)
    expect(devices[0].hostname).toBe('SW-01')
    expect(devices[0].interfaces.length).toBeGreaterThan(0) // template port layout applied
    const nodes = buildNodes(after, PAGE_ID)
    expect(nodes[0]).toMatchObject({ id: devices[0].id, position: { x: 150, y: 90 } })
  })

  it('undo removes the dropped device and its node', () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    store.getState().dispatch(deviceDropCommand(store.getState().data, PAGE_ID, 'pc', 0, 0))
    store.getState().undo()
    const after = store.getState().data
    expect(Object.keys(after.devices)).toHaveLength(0)
    expect(after.pages[PAGE_ID].nodes).toHaveLength(0)
  })

  it('consecutive drops get incrementing hostnames', () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    store.getState().dispatch(deviceDropCommand(store.getState().data, PAGE_ID, 'ip_camera', 0, 0))
    store.getState().dispatch(deviceDropCommand(store.getState().data, PAGE_ID, 'ip_camera', 50, 0))
    const hostnames = Object.values(store.getState().data.devices).map((d) => d.hostname)
    expect(hostnames).toEqual(['CAM-01', 'CAM-02'])
  })
})
