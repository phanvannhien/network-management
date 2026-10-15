import { describe, expect, it } from 'vitest'
import { addDevice, addPage, connectPorts, deleteLink } from '../model/commands'
import { createDevice, createInterface, newId } from '../model/factory'
import { createAppStore } from '../model/store'
import { firstFreePort, kindForMediaGroup, mediaGroup, usedPorts } from '../model/ports'
import { buildEdges } from './adapters'
import { edgeVisual, parallelCurvature } from './edges'

const PAGE_ID = newId()

function makeStoreWithTwoSwitches() {
  const store = createAppStore()
  store
    .getState()
    .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
  const devices = ['SW-01', 'SW-02'].map((hostname) => {
    const device = createDevice({ type: 'l2_switch', hostname })
    device.interfaces = [
      createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }),
      createInterface({ name: 'Gi1/0/2', media: 'rj45', speed: '1G' }),
      createInterface({ name: 'Gi1/1/1', media: 'sfp', speed: '1G' }),
    ]
    return device
  })
  for (const [i, device] of devices.entries()) {
    store.getState().dispatch(addDevice(device, PAGE_ID, i * 200, 0))
  }
  return { store, devices }
}

describe('model: ports', () => {
  it('mediaGroup classifies media into SRS §4 groups', () => {
    expect(mediaGroup('rj45')).toBe('copper')
    expect(mediaGroup('sfp')).toBe('fiber')
    expect(mediaGroup('sfp_plus')).toBe('fiber')
    expect(mediaGroup('fiber_mm')).toBe('fiber')
    expect(mediaGroup('radio')).toBe('wireless')
    expect(mediaGroup('serial')).toBe('serial')
    expect(mediaGroup('console')).toBe('console')
    expect(mediaGroup('logical')).toBe('logical')
  })

  it('usedPorts lists both ends of every link', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    store
      .getState()
      .dispatch(
        connectPorts(
          PAGE_ID,
          { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
          { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
          'ethernet',
        ),
      )
    const used = usedPorts(store.getState().data)
    expect(used.has(`${devices[0].id}:${devices[0].interfaces[0].id}`)).toBe(true)
    expect(used.has(`${devices[1].id}:${devices[1].interfaces[0].id}`)).toBe(true)
    expect(used.size).toBe(2)
  })

  it('firstFreePort skips used ports and only matches the media group', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    store
      .getState()
      .dispatch(
        connectPorts(
          PAGE_ID,
          { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
          { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
          'ethernet',
        ),
      )
    const data = store.getState().data
    const used = usedPorts(data)
    // Gi1/0/1 is used → next copper port is Gi1/0/2, not the SFP port.
    expect(firstFreePort(data, devices[0].id, 'copper', used)?.name).toBe('Gi1/0/2')
    expect(firstFreePort(data, devices[0].id, 'fiber', used)?.name).toBe('Gi1/1/1')
    expect(firstFreePort(data, devices[1].id, 'console', used)).toBeNull()
  })
})

describe('model: connectPorts', () => {
  it('creates the link and the view edge in one undo step', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    store
      .getState()
      .dispatch(
        connectPorts(
          PAGE_ID,
          { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
          { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
          'ethernet',
        ),
      )
    expect(Object.keys(store.getState().data.links)).toHaveLength(1)
    expect(store.getState().data.pages[PAGE_ID].edges).toHaveLength(1)
    expect(buildEdges(store.getState().data, PAGE_ID)).toHaveLength(1)

    store.getState().undo()
    expect(Object.keys(store.getState().data.links)).toHaveLength(0)
    expect(store.getState().data.pages[PAGE_ID].edges).toHaveLength(0)
  })

  it('a second link into the same port is still rejected', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    const a = { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id }
    const b = { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id }
    store.getState().dispatch(connectPorts(PAGE_ID, a, b, 'ethernet'))
    expect(() => store.getState().dispatch(connectPorts(PAGE_ID, a, b, 'ethernet'))).toThrow(
      /already linked/,
    )
  })

  it('deleting the link frees the port for reuse', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    const a = { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id }
    const b = { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id }
    store.getState().dispatch(connectPorts(PAGE_ID, a, b, 'ethernet'))
    const linkId = Object.keys(store.getState().data.links)[0]
    store.getState().dispatch(deleteLink(linkId))
    // Same ports are connectable again after the link is gone.
    expect(() => store.getState().dispatch(connectPorts(PAGE_ID, a, b, 'ethernet'))).not.toThrow()
  })
})

describe('canvas: edge visuals', () => {
  it('maps kind to dash pattern and status to color (SRS §4)', () => {
    expect(edgeVisual({ kind: 'ethernet', status: 'up' }).style.strokeDasharray).toBeUndefined()
    expect(edgeVisual({ kind: 'ethernet', status: 'up' }).style.stroke).toBe('#16a34a')
    expect(edgeVisual({ kind: 'wireless', status: 'up' }).style.strokeDasharray).toBe('5 4')
    expect(edgeVisual({ kind: 'serial', status: 'down' }).style.strokeDasharray).toBe('2 3')
    expect(edgeVisual({ kind: 'console', status: 'planned' }).style.strokeDasharray).toBe('1 4')
    expect(edgeVisual({ kind: 'logical', status: 'planned' }).style.stroke).toBe('#94a3b8')
    expect(edgeVisual({ kind: 'fiber', status: 'up' }).style.strokeWidth).toBe(3)
  })

  it('parallel links get increasing curvature so they do not overlap', () => {
    expect(parallelCurvature(0)).toBeLessThan(parallelCurvature(1))
    expect(parallelCurvature(1)).toBeLessThan(parallelCurvature(2))
  })

  it('buildEdges assigns distinct curvature per parallel link', () => {
    const { store, devices } = makeStoreWithTwoSwitches()
    const s = store.getState()
    s.dispatch(
      connectPorts(
        PAGE_ID,
        { deviceId: devices[0].id, interfaceId: devices[0].interfaces[0].id },
        { deviceId: devices[1].id, interfaceId: devices[1].interfaces[0].id },
        'ethernet',
      ),
    )
    s.dispatch(
      connectPorts(
        PAGE_ID,
        { deviceId: devices[0].id, interfaceId: devices[0].interfaces[1].id },
        { deviceId: devices[1].id, interfaceId: devices[1].interfaces[1].id },
        'ethernet',
      ),
    )
    const edges = buildEdges(store.getState().data, PAGE_ID)
    const curvatures = edges.map(
      (e) => (e as unknown as { pathOptions?: { curvature: number } }).pathOptions?.curvature,
    )
    expect(edges).toHaveLength(2)
    expect(curvatures[0]).not.toBe(curvatures[1])
  })
})

describe('catalog: kind for media group', () => {
  it('matches SRS §4 kinds', () => {
    expect(kindForMediaGroup('copper')).toBe('ethernet')
    expect(kindForMediaGroup('fiber')).toBe('fiber')
    expect(kindForMediaGroup('wireless')).toBe('wireless')
    expect(kindForMediaGroup('serial')).toBe('serial')
  })
})
