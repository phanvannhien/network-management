import type { NtbData } from '../model/types'
import { mediaGroup } from '../model/ports'
import { cidrContains, isBroadcastAddress, isNetworkAddress, networkKey, parseCidr } from './cidr'

export type Severity = 'error' | 'warning' | 'info'

export interface Problem {
  /** Stable key for list dedupe / react keys, e.g. "duplicate-hostname:SW-01". */
  key: string
  severity: Severity
  message: string
  /** What to focus when the problem is clicked. */
  target: { kind: 'device' | 'link'; id: string }
}

export type ValidationRule = (data: NtbData) => Problem[]

/** R1 — IP sai định dạng / là network hoặc broadcast (Error). */
export const ipFormatRule: ValidationRule = (data) => {
  const problems: Problem[] = []
  for (const device of Object.values(data.devices)) {
    for (const iface of device.interfaces ?? []) {
      for (const ip of iface.ipAddresses ?? []) {
        if (parseCidr(ip) === null) {
          problems.push({
            key: `ip-format:${iface.id}:${ip}`,
            severity: 'error',
            message: `${device.hostname} · ${iface.name}: IP "${ip}" sai định dạng (cần 10.0.0.1/24)`,
            target: { kind: 'device', id: device.id },
          })
        } else if (isNetworkAddress(ip)) {
          problems.push({
            key: `ip-network:${iface.id}:${ip}`,
            severity: 'error',
            message: `${device.hostname} · ${iface.name}: "${ip}" là địa chỉ network, không dùng được cho host`,
            target: { kind: 'device', id: device.id },
          })
        } else if (isBroadcastAddress(ip)) {
          problems.push({
            key: `ip-broadcast:${iface.id}:${ip}`,
            severity: 'error',
            message: `${device.hostname} · ${iface.name}: "${ip}" là địa chỉ broadcast, không dùng được cho host`,
            target: { kind: 'device', id: device.id },
          })
        }
      }
    }
  }
  return problems
}

/** R2 — Trùng IP trong cùng VRF (Error). VRF suy từ subnet chứa IP, mặc định "default". */
export const duplicateIpRule: ValidationRule = (data) => {
  const seen = new Map<string, { device: string; iface: string; hostname: string }>()
  const problems: Problem[] = []
  const vrfOf = (ip: string): string => {
    for (const subnet of Object.values(data.subnets)) {
      if (cidrContains(subnet.cidr, ip)) return subnet.vrf || 'default'
    }
    return 'default'
  }
  for (const device of Object.values(data.devices)) {
    for (const iface of device.interfaces ?? []) {
      for (const ip of iface.ipAddresses ?? []) {
        const key = `${vrfOf(ip.split('/')[0])}:${ip}`
        const previous = seen.get(key)
        if (previous) {
          problems.push({
            key: `duplicate-ip:${iface.id}:${ip}`,
            severity: 'error',
            message: `IP ${ip} trùng giữa ${previous.hostname} · ${previous.iface} và ${device.hostname} · ${iface.name} (cùng VRF)`,
            target: { kind: 'device', id: device.id },
          })
        } else {
          seen.set(key, { device: device.id, iface: iface.name, hostname: device.hostname })
        }
      }
    }
  }
  return problems
}

/** R3 — Trùng hostname (Error). */
export const duplicateHostnameRule: ValidationRule = (data) => {
  const seen = new Map<string, string>()
  const problems: Problem[] = []
  for (const device of Object.values(data.devices)) {
    const key = device.hostname.toLowerCase()
    const firstId = seen.get(key)
    if (firstId !== undefined) {
      problems.push({
        key: `duplicate-hostname:${device.id}`,
        severity: 'error',
        message: `Hostname "${device.hostname}" bị trùng`,
        target: { kind: 'device', id: device.id },
      })
    } else {
      seen.set(key, device.id)
    }
  }
  return problems
}

/** R4 — Một cổng vật lý có > 1 link (Error). */
export const multipleLinksPerPortRule: ValidationRule = (data) => {
  const usage = new Map<string, { count: number; hostname: string; port: string }>()
  for (const link of Object.values(data.links)) {
    for (const end of [link.a, link.b]) {
      const key = `${end.deviceId}:${end.interfaceId}`
      const device = data.devices[end.deviceId]
      const port = device?.interfaces.find((i) => i.id === end.interfaceId)?.name ?? '?'
      const entry = usage.get(key)
      if (entry) entry.count += 1
      else usage.set(key, { count: 1, hostname: device?.hostname ?? '?', port })
    }
  }
  const problems: Problem[] = []
  for (const link of Object.values(data.links)) {
    for (const end of [link.a, link.b]) {
      const entry = usage.get(`${end.deviceId}:${end.interfaceId}`)
      if (entry && entry.count > 1) {
        problems.push({
          key: `multi-link:${link.id}:${end.interfaceId}`,
          severity: 'error',
          message: `${entry.hostname} · ${entry.port} có nhiều hơn 1 link`,
          target: { kind: 'link', id: link.id },
        })
      }
    }
  }
  return problems
}

/** R5 — Nối sai loại cổng, ví dụ RJ45 ↔ SFP (Warning). */
export const mediaMismatchRule: ValidationRule = (data) => {
  const problems: Problem[] = []
  for (const link of Object.values(data.links)) {
    const ifaceA = data.devices[link.a.deviceId]?.interfaces.find(
      (i) => i.id === link.a.interfaceId,
    )
    const ifaceB = data.devices[link.b.deviceId]?.interfaces.find(
      (i) => i.id === link.b.interfaceId,
    )
    if (!ifaceA || !ifaceB) continue
    if (mediaGroup(ifaceA.media) !== mediaGroup(ifaceB.media)) {
      problems.push({
        key: `media-mismatch:${link.id}`,
        severity: 'warning',
        message: `Link sai loại cổng: ${ifaceA.media} ↔ ${ifaceB.media}`,
        target: { kind: 'link', id: link.id },
      })
    }
  }
  return problems
}

/** R6 — Gateway không thuộc subnet của nó (Warning). */
export const gatewayOutsideSubnetRule: ValidationRule = (data) => {
  const problems: Problem[] = []
  for (const subnet of Object.values(data.subnets)) {
    if (!subnet.gateway) continue
    if (!cidrContains(subnet.cidr, subnet.gateway)) {
      problems.push({
        key: `gateway-outside:${subnet.id}`,
        severity: 'warning',
        message: `Gateway ${subnet.gateway} không nằm trong subnet ${subnet.cidr}`,
        // Focus the device using that gateway IP, if any; clicking a problem
        // with an unknown target is a no-op on the canvas.
        target: { kind: 'device', id: nearestDeviceWithIp(data, subnet.gateway) ?? '' },
      })
    }
  }
  return problems
}

function nearestDeviceWithIp(data: NtbData, ip: string): string | undefined {
  for (const device of Object.values(data.devices)) {
    for (const iface of device.interfaces ?? []) {
      if ((iface.ipAddresses ?? []).some((candidate) => candidate.split('/')[0] === ip)) {
        return device.id
      }
    }
  }
  return undefined
}

/** R7 — Hai đầu link L3 khác subnet (Warning): chỉ xét khi 2 cổng đều có IP. */
export const l3SubnetMismatchRule: ValidationRule = (data) => {
  const problems: Problem[] = []
  for (const link of Object.values(data.links)) {
    const ifaceA = data.devices[link.a.deviceId]?.interfaces.find(
      (i) => i.id === link.a.interfaceId,
    )
    const ifaceB = data.devices[link.b.deviceId]?.interfaces.find(
      (i) => i.id === link.b.interfaceId,
    )
    const ipA = ifaceA?.ipAddresses?.[0]
    const ipB = ifaceB?.ipAddresses?.[0]
    if (!ipA || !ipB) continue
    const netA = networkKey(ipA)
    const netB = networkKey(ipB)
    if (netA !== null && netB !== null && netA !== netB) {
      problems.push({
        key: `l3-mismatch:${link.id}`,
        severity: 'warning',
        message: `2 đầu link khác subnet: ${ipA} và ${ipB}`,
        target: { kind: 'link', id: link.id },
      })
    }
  }
  return problems
}

/** R8 — Thiết bị không có link nào (Info). */
export const orphanDeviceRule: ValidationRule = (data) => {
  const linked = new Set<string>()
  for (const link of Object.values(data.links)) {
    linked.add(link.a.deviceId)
    linked.add(link.b.deviceId)
  }
  const problems: Problem[] = []
  for (const device of Object.values(data.devices)) {
    if (!linked.has(device.id)) {
      problems.push({
        key: `orphan:${device.id}`,
        severity: 'info',
        message: `${device.hostname} chưa có link nào`,
        target: { kind: 'device', id: device.id },
      })
    }
  }
  return problems
}

export const MVP_RULES: ValidationRule[] = [
  ipFormatRule,
  duplicateIpRule,
  duplicateHostnameRule,
  multipleLinksPerPortRule,
  mediaMismatchRule,
  gatewayOutsideSubnetRule,
  l3SubnetMismatchRule,
  orphanDeviceRule,
]

/** Worst severity for one device, for the node badge. */
export function severityForDevice(problems: Problem[], deviceId: string): Severity | null {
  let worst: Severity | null = null
  for (const problem of problems) {
    if (problem.target.kind !== 'device' || problem.target.id !== deviceId) continue
    if (problem.severity === 'error') return 'error'
    if (problem.severity === 'warning') worst = 'warning'
    else if (worst === null) worst = 'info'
  }
  return worst
}
