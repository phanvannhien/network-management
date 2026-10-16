import { describe, expect, it } from 'vitest'
import { addDevice, addLink, addPage } from '../model/commands'
import { createDevice, createInterface, createLink, newId } from '../model/factory'
import { createAppStore } from '../model/store'
import { buildEdges, buildNodes } from './adapters'
import { DEFAULT_LABEL_TEMPLATE, renderLabelTemplate } from './labels'

const PAGE_ID = newId()

const DEVICE = (() => {
  const d = createDevice({
    type: 'l2_switch',
    hostname: 'SW-ACC-01',
    vendor: 'Cisco',
    model: 'C9200',
  })
  d.mgmtIp = '10.0.0.11/24'
  d.site = 'HQ'
  return d
})()

describe('canvas: label template (SRS §4)', () => {
  it('default template is hostname + mgmtIp', () => {
    expect(DEFAULT_LABEL_TEMPLATE).toBe('{hostname}\n{mgmtIp}')
    expect(renderLabelTemplate(undefined, DEVICE)).toBe('SW-ACC-01\n10.0.0.11/24')
  })

  it('custom template supports all placeholders', () => {
    expect(renderLabelTemplate('{model} ({vendor})', DEVICE)).toBe('C9200 (Cisco)')
    expect(renderLabelTemplate('{hostname} — {site}', DEVICE)).toBe('SW-ACC-01 — HQ')
  })

  it('unknown placeholders are left as-is; missing values become empty', () => {
    expect(renderLabelTemplate('{hostname}/{bogus}', DEVICE)).toBe('SW-ACC-01/{bogus}')
    expect(renderLabelTemplate('{mgmtIp}', createDevice({ type: 'pc', hostname: 'PC-01' }))).toBe(
      '',
    )
  })

  it('buildNodes attaches the rendered label to node data', () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    store.getState().dispatch(addDevice(DEVICE, PAGE_ID, 0, 0))
    const [node] = buildNodes(store.getState().data, PAGE_ID)
    expect(node.data.label).toBe('SW-ACC-01\n10.0.0.11/24')
  })
})

describe('canvas: edge labels', () => {
  it('buildEdges carries port names and speed for the LinkEdge component', () => {
    const store = createAppStore()
    store
      .getState()
      .dispatch(addPage({ id: PAGE_ID, name: 'P1', layer: 'physical', nodes: [], edges: [] }))
    const a = createDevice({ type: 'l2_switch', hostname: 'A' })
    a.interfaces.push(createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }))
    const b = createDevice({ type: 'server', hostname: 'B' })
    b.interfaces.push(createInterface({ name: 'eth0', media: 'rj45', speed: '1G' }))
    store.getState().dispatch(addDevice(a, PAGE_ID, 0, 0))
    store.getState().dispatch(addDevice(b, PAGE_ID, 200, 0))
    const link = createLink({
      kind: 'ethernet',
      a: { deviceId: a.id, interfaceId: a.interfaces[0].id },
      b: { deviceId: b.id, interfaceId: b.interfaces[0].id },
    })
    link.speed = '1G'
    store.getState().dispatch(addLink(link))
    store.getState().dispatch({
      apply(draft) {
        draft.pages[PAGE_ID].edges.push({ refId: link.id, routing: 'straight', waypoints: [] })
      },
    })

    const [edge] = buildEdges(store.getState().data, PAGE_ID)
    expect(edge.type).toBe('link')
    expect(edge.data).toMatchObject({
      sourceLabel: 'Gi1/0/1',
      targetLabel: 'eth0',
      speed: '1G',
    })
  })
})
