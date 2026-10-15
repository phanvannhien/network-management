import { describe, expect, it } from 'vitest'
import { addDevice, addLink, addPage, setNodePosition } from '../model/commands'
import { createDevice, createInterface, createLink, newId } from '../model/factory'
import { createAppStore } from '../model/store'
import { buildEdges, buildNodes, firstPageId } from './adapters'

const PAGE_ID = newId()

function makeStoreWithData() {
  const store = createAppStore()
  store
    .getState()
    .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
  const sw = createDevice({ type: 'l2_switch', hostname: 'SW-A' })
  sw.interfaces.push(createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }))
  const srv = createDevice({ type: 'server', hostname: 'SRV-B' })
  srv.interfaces.push(createInterface({ name: 'eth0', media: 'rj45', speed: '1G' }))
  store.getState().dispatch(addDevice(sw, PAGE_ID, 40, 20))
  store.getState().dispatch(addDevice(srv, PAGE_ID, 200, 20))
  return { store, sw, srv }
}

describe('canvas adapters', () => {
  it('builds one React Flow node per page node, position from the view model', () => {
    const { store } = makeStoreWithData()
    const nodes = buildNodes(store.getState().data, PAGE_ID)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      id: expect.any(String),
      type: 'device',
      position: { x: 40, y: 20 },
    })
    expect(nodes[0].data.deviceId).toBeDefined()
  })

  it('builds edges only for links with an edge on the page', () => {
    const { store, sw, srv } = makeStoreWithData()
    // A link exists in the network model but has no view edge yet → not drawn.
    const link = createLink({
      kind: 'ethernet',
      a: { deviceId: sw.id, interfaceId: sw.interfaces[0].id },
      b: { deviceId: srv.id, interfaceId: srv.interfaces[0].id },
    })
    store.getState().dispatch(addLink(link))
    expect(buildEdges(store.getState().data, PAGE_ID)).toHaveLength(0)

    // Registering the edge on the page makes it visible.
    store.getState().dispatch({
      apply(draft) {
        draft.pages[PAGE_ID].edges.push({ refId: link.id, routing: 'straight', waypoints: [] })
      },
    })
    const edges = buildEdges(store.getState().data, PAGE_ID)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ id: link.id, source: sw.id, target: srv.id })
  })

  it('skips nodes whose device was deleted from the network model', () => {
    const { store } = makeStoreWithData()
    const ghostId = newId()
    store.getState().dispatch({
      apply(draft) {
        draft.pages[PAGE_ID].nodes.push({
          refId: ghostId,
          x: 0,
          y: 0,
          iconAssetId: null,
          locked: false,
        })
      },
    })
    const nodes = buildNodes(store.getState().data, PAGE_ID)
    expect(nodes.map((n) => n.id)).not.toContain(ghostId)
  })

  it('reports moving a node and applies it through the store', () => {
    const { store, sw } = makeStoreWithData()
    store.getState().dispatch(setNodePosition(PAGE_ID, sw.id, 120, 80, `drag:${sw.id}`))
    const nodes = buildNodes(store.getState().data, PAGE_ID)
    expect(nodes.find((n) => n.id === sw.id)?.position).toEqual({ x: 120, y: 80 })
  })

  it('firstPageId returns null for an empty document', () => {
    const store = createAppStore()
    expect(firstPageId(store.getState().data)).toBeNull()
  })
})
