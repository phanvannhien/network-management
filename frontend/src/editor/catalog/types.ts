import type { DeviceType, Interface } from '../../types/ntb'

export type DeviceGroup =
  'core_routing' | 'access_switching' | 'security' | 'end_devices' | 'cloud_wan' | 'other'

/** One run of identical ports, e.g. 24× "Gi1/0/1..24" RJ45 1G. */
export interface PortRun {
  /** Name prefix; the 1-based port number (starting at `start`) is appended. */
  prefix: string
  count: number
  start?: number
  media: Interface['media']
  speed: Interface['speed']
  mode?: Interface['mode']
  poe?: boolean
}

export interface DeviceTemplate {
  /** Matches the `deviceType` enum in schema/ntb.schema.json. */
  typeId: DeviceType
  group: DeviceGroup
  /** English display name; Vietnamese comes from i18n in P1-12 (key: `device.<typeId>`). */
  label: string
  defaultVendor?: string
  defaultModel?: string
  portRuns: PortRun[]
}

export function generateInterfaces(runs: PortRun[]): Interface[] {
  const interfaces: Interface[] = []
  for (const run of runs) {
    const start = run.start ?? 1
    for (let i = 0; i < run.count; i++) {
      interfaces.push({
        id: crypto.randomUUID(),
        name: `${run.prefix}${start + i}`,
        media: run.media,
        speed: run.speed,
        mode: run.mode ?? 'access',
        allowedVlans: [],
        ipAddresses: [],
        poe: run.poe ?? false,
        lagId: null,
        adminUp: true,
        ifIndex: null,
      })
    }
  }
  return interfaces
}
