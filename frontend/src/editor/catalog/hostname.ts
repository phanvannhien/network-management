import type { DeviceType } from '../../types/ntb'
import type { NtbData } from '../model/types'

/** Short hostname prefixes per device type; unknown types fall back to typeId. */
const PREFIXES: Partial<Record<DeviceType, string>> = {
  router: 'RTR',
  l3_switch: 'SW',
  l2_switch: 'SW',
  poe_switch: 'SW',
  hub: 'HUB',
  access_point: 'AP',
  media_converter: 'MC',
  patch_panel: 'PP',
  firewall: 'FW',
  vpn_gateway: 'VPN',
  load_balancer: 'LB',
  wireless_controller: 'WLC',
  server: 'SRV',
  vm: 'VM',
  nas: 'NAS',
  pc: 'PC',
  laptop: 'LT',
  printer: 'PRN',
  ip_phone: 'PH',
  ip_camera: 'CAM',
  nvr_dvr: 'NVR',
  internet_gateway: 'GW',
  modem: 'MDM',
  sdwan_edge: 'SDW',
  ont_olt: 'OLT',
  ups_pdu: 'UPS',
}

/**
 * Generates the next free hostname for a device type, e.g. "SW-01", "SW-02".
 * Uses the network model only (all pages share one hostname namespace).
 */
export function nextHostname(data: Pick<NtbData, 'devices'>, typeId: DeviceType): string {
  const prefix = PREFIXES[typeId] ?? typeId.toUpperCase().slice(0, 3)
  const hostnames = new Set(Object.values(data.devices).map((d) => d.hostname))
  for (let n = 1; ; n++) {
    const candidate = `${prefix}-${String(n).padStart(2, '0')}`
    if (!hostnames.has(candidate)) return candidate
  }
}
