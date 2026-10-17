import type { DeviceType } from './items'

// Hostname suggestion for devices created on a diagram (P1-15). Pattern: <site code without the organization
// code>-<PREFIX><NN>, e.g. site VPM-AGRI-BD01 + firewall → AGRI-BD01-FW01. Numbers count per site and prefix and
// continue after the highest one in use (a retired number is not reused: logs and monitoring still know it).

export const HOSTNAME_PREFIX: Record<DeviceType, string> = {
  router: 'RTR',
  modem: 'MDM',
  ont: 'ONT',
  sdwan_edge: 'SDW',
  vpn_gateway: 'VPN',
  l3_switch: 'CORE',
  l2_switch: 'SW',
  poe_switch: 'SW',
  wireless_controller: 'WLC',
  access_point: 'AP',
  media_converter: 'MC',
  patch_panel: 'PP',
  firewall: 'FW',
  ids_ips: 'IPS',
  waf: 'WAF',
  nac: 'NAC',
  proxy: 'PRX',
  server: 'SRV',
  vm: 'VM',
  nas: 'NAS',
  load_balancer: 'LB',
  pc: 'PC',
  laptop: 'LT',
  printer: 'PRN',
  ip_phone: 'PHN',
  pbx: 'PBX',
  video_conference: 'VC',
  ip_camera: 'CAM',
  nvr: 'NVR',
  access_control: 'ACS',
  iot: 'IOT',
  ups: 'UPS',
  pdu: 'PDU',
  other: 'DEV',
}

/** The site part of a hostname: the full site code minus the organization code in front. */
export function siteTag(site: { code: string; localCode?: string }): string {
  const rest = site.code.split('-').slice(1).join('-')
  return (rest || site.localCode || site.code).toUpperCase()
}

/** Prefix that hostnames of this site and type start with, e.g. "AGRI-BD01-FW". */
export function hostnameStem(site: { code: string; localCode?: string }, type: DeviceType): string {
  return `${siteTag(site)}-${HOSTNAME_PREFIX[type]}`
}

export function suggestHostname(
  site: { code: string; localCode?: string },
  type: DeviceType,
  taken: Iterable<string>,
): string {
  const stem = hostnameStem(site, type)
  const re = new RegExp(`^${stem.replace(/[-]/g, '\\-')}(\\d+)$`, 'i')
  let max = 0
  for (const h of taken) {
    const m = re.exec(h.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${stem}${String(max + 1).padStart(2, '0')}`
}

export type HostnameProblem = 'chars' | 'dash' | 'length'

/** DNS label rules (RFC 1123), which every vendor accepts: letters, digits, "-", not at either end, ≤ 63. */
export function hostnameProblem(v: string): HostnameProblem | null {
  const s = v.trim()
  if (!/^[A-Za-z0-9-]+$/.test(s)) return 'chars'
  if (s.startsWith('-') || s.endsWith('-')) return 'dash'
  if (s.length > 63) return 'length'
  return null
}

/** Windows computer names stop at 15 characters (NetBIOS): longer server / PC names get cut. */
export function hostnameWarning(v: string, type: DeviceType): 'netbios' | null {
  return ['server', 'pc', 'laptop', 'vm'].includes(type) && v.trim().length > 15 ? 'netbios' : null
}
