import type { components } from '@/api/client'

// What the library offers (P1-15): a device type or an organization template (both create a new device), or a
// device already in the inventory (placed as it is). The same item travels by drag & drop, click and quick-add.

export type DeviceType = components['schemas']['DeviceType']

export type EndpointKind = components['schemas']['EndpointKind']

type DeviceLifecycle = components['schemas']['DeviceLifecycle']
const LIFECYCLES: DeviceLifecycle[] = ['planned', 'active', 'spare', 'rma', 'retired']

/**
 * Kinds drawn as endpoint groups (ADR-036): one node stands for the alike endpoints of a place (cameras on ports
 * 1–24, the PCs of an office), outside the device list. Servers, NAS, VMs stay devices of the inventory.
 */
export const ENDPOINT_KINDS: EndpointKind[] = [
  'pc',
  'laptop',
  'printer',
  'ip_phone',
  'video_conference',
  'ip_camera',
  'access_control',
  'iot',
  'other',
]

export type LibraryItem =
  | { kind: 'type'; type: DeviceType }
  | { kind: 'endpoint'; endpointKind: EndpointKind }
  | { kind: 'template'; templateId: string; type: DeviceType }
  /** A shared network (P2-08): picked or created in a dialog. */
  | { kind: 'segment' }
  | {
      kind: 'device'
      device: {
        id: string
        hostname: string
        type: DeviceType
        siteId: string
        mgmtIp?: string
        model?: string
        siteCode?: string
        managed?: boolean
        catalogId?: string
        partNumber?: string
        lifecycle?: DeviceLifecycle
        eosDate?: string | null
      }
    }

export const LIBRARY_MIME = 'application/x-ntb-library'

export function encodeItem(item: LibraryItem): string {
  return JSON.stringify(item)
}

/** Drop data comes from outside the app too: accept only well-formed items. */
export function decodeItem(raw: string): LibraryItem | null {
  try {
    const v = JSON.parse(raw) as Partial<Record<string, unknown>>
    const str = (x: unknown) => typeof x === 'string' && x !== ''
    if (v.kind === 'type' && str(v.type)) return { kind: 'type', type: v.type as DeviceType }
    if (v.kind === 'segment') return { kind: 'segment' }
    if (v.kind === 'endpoint' && ENDPOINT_KINDS.includes(v.endpointKind as EndpointKind))
      return { kind: 'endpoint', endpointKind: v.endpointKind as EndpointKind }
    if (v.kind === 'template' && str(v.templateId) && str(v.type))
      return { kind: 'template', templateId: v.templateId as string, type: v.type as DeviceType }
    const d = v.device as Partial<Record<string, unknown>> | undefined
    if (v.kind === 'device' && d && str(d.id) && str(d.hostname) && str(d.type) && str(d.siteId))
      return {
        kind: 'device',
        device: {
          id: d.id as string,
          hostname: d.hostname as string,
          type: d.type as DeviceType,
          siteId: d.siteId as string,
          mgmtIp: typeof d.mgmtIp === 'string' ? d.mgmtIp : undefined,
          model: typeof d.model === 'string' ? d.model : undefined,
          siteCode: typeof d.siteCode === 'string' ? d.siteCode : undefined,
          managed: typeof d.managed === 'boolean' ? d.managed : undefined,
          catalogId: typeof d.catalogId === 'string' ? d.catalogId : undefined,
          partNumber: typeof d.partNumber === 'string' ? d.partNumber : undefined,
          lifecycle: LIFECYCLES.includes(d.lifecycle as DeviceLifecycle)
            ? (d.lifecycle as DeviceLifecycle)
            : undefined,
          eosDate: typeof d.eosDate === 'string' ? d.eosDate : undefined,
        },
      }
  } catch {
    // not ours
  }
  return null
}
