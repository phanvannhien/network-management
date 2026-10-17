import type { components } from '@/api/client'

// What the library offers (P1-15): a device type or an organization template (both create a new device), or a
// device already in the inventory (placed as it is). The same item travels by drag & drop, click and quick-add.

export type DeviceType = components['schemas']['DeviceType']

export type LibraryItem =
  | { kind: 'type'; type: DeviceType }
  | { kind: 'template'; templateId: string; type: DeviceType }
  | {
      kind: 'device'
      device: { id: string; hostname: string; type: DeviceType; siteId: string; mgmtIp?: string }
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
        },
      }
  } catch {
    // not ours
  }
  return null
}
