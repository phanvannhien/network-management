/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDevice, createInterface, createLink } from '../model/factory'
import { fromNtbProjectFile } from '../model/io'
import { emptyData, type NtbData } from '../model/types'
import {
  duplicateHostnameRule,
  duplicateIpRule,
  gatewayOutsideSubnetRule,
  ipFormatRule,
  l3SubnetMismatchRule,
  mediaMismatchRule,
  multipleLinksPerPortRule,
  orphanDeviceRule,
  severityForDevice,
} from './rules'
import { cidrContains, isBroadcastAddress, isNetworkAddress, parseCidr } from './cidr'
import { runValidation } from './engine'
import type { Problem } from './rules'

function deviceWithIps(hostname: string, ips: string[]) {
  const device = createDevice({ type: 'server', hostname })
  device.interfaces = ips.map((ip, i) => {
    const iface = createInterface({ name: `eth${i}`, media: 'rj45', speed: '1G' })
    iface.ipAddresses = [ip]
    return iface
  })
  return device
}

describe('validation: cidr helpers', () => {
  it('parses strict CIDRs and computes network/broadcast', () => {
    const info = parseCidr('10.0.0.11/24')
    expect(info).not.toBeNull()
    expect(info!.network.join('.')).toBe('10.0.0.0')
    expect(info!.broadcast.join('.')).toBe('10.0.0.255')
    expect(isNetworkAddress('10.0.0.0/24')).toBe(true)
    expect(isNetworkAddress('10.0.0.1/24')).toBe(false)
    expect(isBroadcastAddress('10.0.0.255/24')).toBe(true)
    expect(isBroadcastAddress('10.0.0.11/24')).toBe(false)
    expect(parseCidr('10.0.0/24')).toBeNull() // shorthand rejected
    expect(cidrContains('10.0.0.0/24', '10.0.0.99')).toBe(true)
    expect(cidrContains('10.0.0.0/24', '10.0.1.1')).toBe(false)
  })
})

describe('validation: ipFormatRule (SRS §6 R1, Error)', () => {
  it('accepts a normal host IP', () => {
    const data = emptyData()
    data.devices['d1'] = deviceWithIps('SRV-01', ['10.0.0.11/24'])
    expect(ipFormatRule(data)).toHaveLength(0)
  })

  it('rejects malformed, network and broadcast addresses', () => {
    const data = emptyData()
    data.devices['d1'] = deviceWithIps('SRV-01', ['10.0.0', '10.0.0.0/24', '10.0.0.255/24'])
    const problems = ipFormatRule(data)
    expect(problems).toHaveLength(3)
    expect(problems.every((p) => p.severity === 'error')).toBe(true)
    expect(problems.map((p) => p.key.split(':')[0])).toEqual([
      'ip-format',
      'ip-network',
      'ip-broadcast',
    ])
  })
})

describe('validation: duplicateIpRule (SRS §6 R2, Error)', () => {
  it('accepts unique IPs, flags duplicates in the same VRF', () => {
    const data = emptyData()
    data.devices['d1'] = deviceWithIps('SRV-01', ['10.0.0.11/24'])
    data.devices['d2'] = deviceWithIps('SRV-02', ['10.0.0.12/24'])
    expect(duplicateIpRule(data)).toHaveLength(0)

    data.devices['d2'].interfaces[0].ipAddresses = ['10.0.0.11/24']
    const problems = duplicateIpRule(data)
    expect(problems).toHaveLength(1)
    expect(problems[0].severity).toBe('error')
  })
})

describe('validation: duplicateHostnameRule (SRS §6 R3, Error)', () => {
  it('accepts unique hostnames, flags duplicates case-insensitively', () => {
    const data = emptyData()
    data.devices['d1'] = createDevice({ type: 'pc', hostname: 'PC-01' })
    data.devices['d2'] = createDevice({ type: 'pc', hostname: 'PC-02' })
    expect(duplicateHostnameRule(data)).toHaveLength(0)

    data.devices['d2'].hostname = 'pc-01'
    const problems = duplicateHostnameRule(data)
    expect(problems).toHaveLength(1)
    expect(problems[0].severity).toBe('error')
  })
})

describe('validation: multipleLinksPerPortRule (SRS §6 R4, Error)', () => {
  it('accepts one link per port, flags a port used twice', () => {
    const data = emptyData()
    const a = createDevice({ type: 'l2_switch', hostname: 'SW-01' })
    a.interfaces = [createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' })]
    const b = createDevice({ type: 'pc', hostname: 'PC-01' })
    b.interfaces = [
      createInterface({ name: 'eth0', media: 'rj45', speed: '1G' }),
      createInterface({ name: 'eth1', media: 'rj45', speed: '1G' }),
    ]
    data.devices['a'] = a
    data.devices['b'] = b
    data.links['l1'] = createLink({
      kind: 'ethernet',
      a: { deviceId: 'a', interfaceId: a.interfaces[0].id },
      b: { deviceId: 'b', interfaceId: b.interfaces[0].id },
    })
    expect(multipleLinksPerPortRule(data)).toHaveLength(0)

    // Second link into the same switch port — possible via imported files.
    data.links['l2'] = createLink({
      kind: 'ethernet',
      a: { deviceId: 'a', interfaceId: a.interfaces[0].id },
      b: { deviceId: 'b', interfaceId: b.interfaces[1].id },
    })
    const problems = multipleLinksPerPortRule(data)
    expect(problems).toHaveLength(2) // one per offending endpoint instance
    expect(problems.every((p) => p.severity === 'error' && p.target.kind === 'link')).toBe(true)
  })
})

describe('validation: mediaMismatchRule (SRS §6 R5, Warning)', () => {
  it('accepts matching media groups, flags RJ45 ↔ SFP', () => {
    const data = emptyData()
    const sw = createDevice({ type: 'l2_switch', hostname: 'SW-01' })
    sw.interfaces = [
      createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' }),
      createInterface({ name: 'Gi1/1/1', media: 'sfp', speed: '1G' }),
    ]
    const srv = createDevice({ type: 'server', hostname: 'SRV-01' })
    srv.interfaces = [createInterface({ name: 'eno1', media: 'rj45', speed: '1G' })]
    data.devices['sw'] = sw
    data.devices['srv'] = srv
    data.links['ok'] = createLink({
      kind: 'ethernet',
      a: { deviceId: 'sw', interfaceId: sw.interfaces[0].id },
      b: { deviceId: 'srv', interfaceId: srv.interfaces[0].id },
    })
    expect(mediaMismatchRule(data)).toHaveLength(0)

    data.links['bad'] = createLink({
      kind: 'ethernet',
      a: { deviceId: 'sw', interfaceId: sw.interfaces[1].id },
      b: { deviceId: 'srv', interfaceId: srv.interfaces[0].id },
    })
    const problems = mediaMismatchRule(data)
    expect(problems).toHaveLength(1)
    expect(problems[0].severity).toBe('warning')
  })
})

describe('validation: gatewayOutsideSubnetRule (SRS §6 R6, Warning)', () => {
  it('accepts a gateway inside its subnet, flags one outside', () => {
    const data = emptyData()
    data.subnets['s1'] = { id: 's1', cidr: '10.0.0.0/24', gateway: '10.0.0.1', vrf: 'default' }
    expect(gatewayOutsideSubnetRule(data)).toHaveLength(0)

    data.subnets['s2'] = { id: 's2', cidr: '192.168.20.0/24', gateway: '10.0.5.1', vrf: 'default' }
    const problems = gatewayOutsideSubnetRule(data)
    expect(problems).toHaveLength(1)
    expect(problems[0].severity).toBe('warning')
    expect(problems[0].message).toContain('192.168.20.0/24')
  })
})

describe('validation: l3SubnetMismatchRule (SRS §6 R7, Warning)', () => {
  it('accepts same-subnet L3 links, flags different subnets, skips L2 links', () => {
    const data = emptyData()
    const a = deviceWithIps('RTR-01', ['10.0.0.1/24'])
    const b = deviceWithIps('FW-01', ['10.0.0.2/24'])
    data.devices['a'] = a
    data.devices['b'] = b
    data.links['l1'] = createLink({
      kind: 'ethernet',
      a: { deviceId: 'a', interfaceId: a.interfaces[0].id },
      b: { deviceId: 'b', interfaceId: b.interfaces[0].id },
    })
    expect(l3SubnetMismatchRule(data)).toHaveLength(0)

    b.interfaces[0].ipAddresses = ['192.168.99.2/24']
    expect(l3SubnetMismatchRule(data)).toHaveLength(1)

    // L2 link without IPs is skipped.
    b.interfaces[0].ipAddresses = []
    expect(l3SubnetMismatchRule(data)).toHaveLength(0)
  })
})

describe('validation: orphanDeviceRule (SRS §6 R8, Info)', () => {
  it('flags devices without links', () => {
    const data = emptyData()
    const a = createDevice({ type: 'l2_switch', hostname: 'SW-01' })
    a.interfaces = [createInterface({ name: 'Gi1/0/1', media: 'rj45', speed: '1G' })]
    data.devices['a'] = a
    data.devices['orphan'] = createDevice({ type: 'printer', hostname: 'PRN-01' })
    const problems = orphanDeviceRule(data)
    // Both the switch (never linked in this fixture) and the printer are orphans.
    expect(problems).toHaveLength(2)
    expect(problems.every((p) => p.severity === 'info')).toBe(true)
    expect(problems.map((p) => p.target.id)).toEqual([
      data.devices['a'].id,
      data.devices['orphan'].id,
    ])
  })
})

describe('validation: badge severity', () => {
  it('returns the worst severity for a device', () => {
    const problems: Problem[] = [
      {
        key: 'a',
        severity: 'info',
        message: '',
        target: { kind: 'device', id: 'd1' },
      },
      {
        key: 'b',
        severity: 'warning',
        message: '',
        target: { kind: 'device', id: 'd1' },
      },
      {
        key: 'c',
        severity: 'error',
        message: '',
        target: { kind: 'link', id: 'l1' },
      },
    ]
    expect(severityForDevice(problems, 'd1')).toBe('warning')
    expect(severityForDevice(problems, 'd2')).toBeNull()
    problems.push({
      key: 'd',
      severity: 'error',
      message: '',
      target: { kind: 'device', id: 'd1' },
    })
    expect(severityForDevice(problems, 'd1')).toBe('error')
  })
})

describe('validation: engine', () => {
  it('combines all rules', () => {
    const data: NtbData = emptyData()
    data.devices['d1'] = deviceWithIps('SRV-01', ['10.0.0.0/24']) // network address
    data.devices['d2'] = deviceWithIps('SRV-01', []) // duplicate hostname + orphan
    const problems = runValidation(data)
    expect(problems.some((p) => p.key.startsWith('ip-network:'))).toBe(true)
    expect(problems.some((p) => p.key.startsWith('duplicate-hostname:'))).toBe(true)
    expect(problems.filter((p) => p.key.startsWith('orphan:')).length).toBe(2)
  })

  it('the sample project file is clean', () => {
    const samplePath = path.resolve(__dirname, '../../../../testdata/legacy/sample-small.ntb.json')
    const file = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    expect(runValidation(fromNtbProjectFile(file))).toEqual([])
  })
})
