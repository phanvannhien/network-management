import type { Device, Interface, Link } from '../types/ntb'

export function newId(): string {
  return crypto.randomUUID()
}

export function createInterface(props: Pick<Interface, 'name' | 'media' | 'speed'>): Interface {
  return {
    id: newId(),
    mode: 'access',
    allowedVlans: [],
    ipAddresses: [],
    poe: false,
    lagId: null,
    adminUp: true,
    ifIndex: null,
    ...props,
  }
}

export function createDevice(props: {
  type: Device['type']
  hostname: string
  vendor?: string
  model?: string
}): Device {
  return {
    id: newId(),
    role: 'none',
    lifecycle: 'planned',
    customFields: {},
    monitoring: { enabled: false, snmpProfileId: null },
    interfaces: [],
    ...props,
  }
}

export function createLink(props: {
  kind: Link['kind']
  a: { deviceId: string; interfaceId: string }
  b: { deviceId: string; interfaceId: string }
}): Link {
  return {
    id: newId(),
    status: 'planned',
    notes: '',
    ...props,
  }
}
