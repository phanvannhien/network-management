import { describe, expect, it } from 'vitest'
import { updateDevice } from '../doc/commands'
import { createDocStore } from '../doc/store'
import type { DiagramDetail } from '../doc/types'
import { addressProblem } from './portIpamRules'

const SITE = '66666666-6666-4666-8666-666666666666'
const FW = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('panel IPAM (P1-18, ADR-034)', () => {
  it('flags the network and broadcast address of an IPv4 subnet, not /31 or /32', () => {
    expect(addressProblem('10.0.0.0/24')).toBe('network')
    expect(addressProblem('10.0.0.255/24')).toBe('broadcast')
    expect(addressProblem('10.0.0.1/24')).toBe('')
    expect(addressProblem('10.0.0.0/31')).toBe('')
    expect(addressProblem('2001:db8::/64')).toBe('')
  })

  it('an IPAM write syncs the device version and IP without an undo step and keeps "saved" recognisable', () => {
    const s = createDocStore()
    s.getState().load({
      diagram: {
        id: 'd1',
        name: 'LAN',
        layer: 'physical',
        description: '',
        nodeCount: 1,
        updatedAt: '2026-10-17T00:00:00Z',
        access: 'edit',
        version: 1,
      },
      view: {
        nodes: [{ id: 'n1', refKind: 'device', refId: FW, x: 0, y: 0 }],
        edges: [],
        annotations: [],
      },
      devices: [
        { id: FW, hostname: 'FW01', type: 'firewall', siteId: SITE, mgmtIp: '' },
      ] as DiagramDetail['devices'],
      endpointGroups: [],
      links: [],
      hiddenRefs: [],
    })
    s.getState().syncDevice(FW, { version: 5, mgmtIp: '10.0.0.1/24' })
    expect(s.getState().status).toBe('clean')
    expect(s.getState().doc).toBe(s.getState().savedDoc)
    expect(s.getState().doc!.devices[FW]!.mgmtIp).toBe('10.0.0.1/24')
    s.getState().dispatch(
      updateDevice(FW, { hostname: 'FW02', type: 'firewall', siteId: SITE, version: 5 }),
    )
    s.getState().syncDevice(FW, { version: 6 })
    expect(s.getState().doc!.deviceEdits[FW]!.version).toBe(6)
    expect(s.getState().past).toHaveLength(1)
    // Undo lands on the saved document (patched too): clean again, IP kept.
    s.getState().undo()
    expect(s.getState().status).toBe('clean')
    expect(s.getState().doc!.devices[FW]!.mgmtIp).toBe('10.0.0.1/24')
  })
})
