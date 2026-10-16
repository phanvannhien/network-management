import type { JSX } from 'react'
import type { DeviceType } from '../../types/ntb'

/**
 * Line-art device icons on a 24×24 grid, stroked with currentColor so they
 * inherit text color and work in both themes.
 */

const sw = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const box = <rect x="3" y="8" width="18" height="8" rx="1.5" {...sw} />

const arrows = (
  <g {...sw}>
    <path d="M6.5 11h4M9 9.5 10.5 11 9 12.5" />
    <path d="M17.5 13h-4M15 11.5 13.5 13l1.5 1.5" />
  </g>
)

const waves = (x: number) => (
  <g {...sw}>
    <path d={`M${x} 14a3 3 0 0 1 0-4`} />
    <path d={`M${x - 2} 16a6 6 0 0 1 0-8`} />
  </g>
)

const ICON_PATHS: Partial<Record<DeviceType, JSX.Element>> = {
  router: (
    <g>
      {box}
      {arrows}
    </g>
  ),
  l3_switch: (
    <g>
      {box}
      {arrows}
      <path d="M6 14h12" {...sw} strokeDasharray="2 2" />
    </g>
  ),
  l2_switch: (
    <g>
      {box}
      {arrows}
    </g>
  ),
  poe_switch: (
    <g>
      {box}
      {arrows}
      <path d="M13 17.5 11 21h2.5L11.5 23" {...sw} />
    </g>
  ),
  hub: (
    <g>
      {box}
      <g {...sw}>
        <path d="M7 8V5M12 8V5M17 8V5" />
      </g>
    </g>
  ),
  patch_panel: (
    <g>
      <rect x="3" y="9" width="18" height="6" rx="1" {...sw} />
      <g {...sw}>
        <path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01" strokeWidth="2" />
      </g>
    </g>
  ),
  media_converter: (
    <g>
      {box}
      <path d="M8 11h3M13 13h3" {...sw} />
    </g>
  ),
  firewall: (
    <g {...sw}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 9.5h18M3 14.5h18M9 5v4.5M15 9.5v5M9 14.5V19" />
    </g>
  ),
  ids_ips: (
    <g {...sw}>
      <path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </g>
  ),
  vpn_gateway: (
    <g {...sw}>
      <rect x="4" y="10" width="16" height="7" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </g>
  ),
  waf: (
    <g>
      {box}
      <circle cx="12" cy="12" r="2.2" {...sw} />
    </g>
  ),
  nac: (
    <g>
      {box}
      <path d="M9 12a3 3 0 0 1 6 0" {...sw} />
    </g>
  ),
  proxy: (
    <g>
      {box}
      <circle cx="12" cy="12" r="2.2" {...sw} />
    </g>
  ),
  load_balancer: (
    <g {...sw}>
      <path d="M12 4v5" />
      <path d="M12 9 6 14M12 9l6 5" />
      <rect x="3.5" y="14" width="5" height="6" rx="1" />
      <rect x="9.5" y="14" width="5" height="6" rx="1" />
      <rect x="15.5" y="14" width="5" height="6" rx="1" />
    </g>
  ),
  wireless_controller: (
    <g>
      {box}
      {waves(19)}
    </g>
  ),
  server: (
    <g {...sw}>
      <rect x="4" y="3.5" width="16" height="7" rx="1" />
      <rect x="4" y="13.5" width="16" height="7" rx="1" />
      <path d="M7 7h.01M7 17h.01M10 7h4M10 17h4" />
    </g>
  ),
  nas: (
    <g {...sw}>
      <rect x="5" y="4" width="14" height="16" rx="1.5" />
      <path d="M8 8h8M8 12h8M8 16h3" />
    </g>
  ),
  pc: (
    <g {...sw}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M9 20h6M12 16v4" />
    </g>
  ),
  laptop: (
    <g {...sw}>
      <rect x="5" y="5" width="14" height="9" rx="1" />
      <path d="M3 18h18l-1.5 2h-15z" />
    </g>
  ),
  printer: (
    <g {...sw}>
      <path d="M7 8V4h10v4" />
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <rect x="7" y="13" width="10" height="7" />
    </g>
  ),
  ip_camera: (
    <g {...sw}>
      <rect x="3" y="7" width="13" height="10" rx="2" />
      <circle cx="18.5" cy="12" r="3" />
      <path d="M21.5 12v0" />
    </g>
  ),
  nvr_dvr: (
    <g {...sw}>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <circle cx="17" cy="12" r="1.6" />
      <path d="m6 10.5 2.5 1.5L6 13.5z" />
    </g>
  ),
  ip_phone: (
    <g {...sw}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M8 7h5M8 11h8M8 14.5h8M8 18h3" />
    </g>
  ),
  iot: (
    <g {...sw}>
      <rect x="8" y="9" width="8" height="8" rx="1.5" />
      <path d="M12 9V5M9.5 5h5" />
    </g>
  ),
  vm: (
    <g {...sw}>
      <rect x="4" y="5" width="16" height="10" rx="1" />
      <path d="m9 8 3 2-3 2M13 12h3" />
    </g>
  ),
  access_point: (
    <g {...sw}>
      <path d="M12 20v-6" />
      <path d="M9 12a4.2 4.2 0 0 1 6 0" />
      <path d="M6.5 9.5a8 8 0 0 1 11 0" />
      <circle cx="12" cy="14" r="1.2" />
    </g>
  ),
  cloud: (
    <g {...sw}>
      <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.7 3.8 3.8 0 0 1 17.5 18z" />
    </g>
  ),
  internet_gateway: (
    <g {...sw}>
      <rect x="4" y="12" width="16" height="6" rx="1.5" />
      <path d="M8 12V9M16 12V9M8 9a4 4 0 0 1 8 0" />
    </g>
  ),
  modem: (
    <g {...sw}>
      <rect x="3" y="11" width="18" height="7" rx="1.5" />
      <path d="M6 14.5h.01M9 14.5h.01M12 11V6M12 6a3 3 0 0 1 3-3" />
    </g>
  ),
  isp: (
    <g {...sw}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16-2.5-2.5-2.5-13.5 0-16z" />
    </g>
  ),
  mpls_cloud: (
    <g {...sw}>
      <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.7 3.8 3.8 0 0 1 17.5 18z" />
      <path d="M9 13h6M11 15l-2-2 2-2" />
    </g>
  ),
  sdwan_edge: (
    <g {...sw}>
      <rect x="4" y="12" width="16" height="6" rx="1.5" />
      <path d="M12 12V8M9 5h6M12 5v3" />
    </g>
  ),
  ont_olt: (
    <g {...sw}>
      <rect x="4" y="10" width="16" height="8" rx="1.5" />
      <path d="M7 10V6c0-1.5 2-1.5 2 0M12 10V6c0-1.5 2-1.5 2 0" />
    </g>
  ),
  ups_pdu: (
    <g {...sw}>
      <rect x="5" y="4" width="14" height="16" rx="1.5" />
      <path d="M13 7l-3.5 5H12l-1 4 3.5-5H12z" />
    </g>
  ),
  text_note: (
    <g {...sw}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h6M9 16h6" />
    </g>
  ),
  zone: (
    <g {...sw} strokeDasharray="3 2">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </g>
  ),
  rack: (
    <g {...sw}>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M9 7h6M9 11h6M9 15h6" />
    </g>
  ),
}

const GENERIC_ICON = (
  <g>
    {box}
    <circle cx="12" cy="12" r="1.5" {...sw} />
  </g>
)

export function DeviceIcon({
  typeId,
  size = 24,
  className,
}: {
  typeId: DeviceType
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      role="img"
    >
      {ICON_PATHS[typeId] ?? GENERIC_ICON}
    </svg>
  )
}
