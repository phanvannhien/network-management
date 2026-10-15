import type { Link } from '../types/ntb'
import type { NtbData } from './types'

/** Media groups that can be linked together (SRS §4: cổng hợp lệ theo loại). */
export type MediaGroup = 'copper' | 'fiber' | 'wireless' | 'serial' | 'console' | 'logical'

export function mediaGroup(media: string): MediaGroup {
  if (media.startsWith('sfp') || media.startsWith('fiber') || media === 'dac') return 'fiber'
  if (media === 'radio') return 'wireless'
  if (media === 'serial') return 'serial'
  if (media === 'console') return 'console'
  if (media === 'logical') return 'logical'
  return 'copper' // rj45
}

export function kindForMediaGroup(group: MediaGroup): Link['kind'] {
  return group === 'copper' ? 'ethernet' : group
}

/** Keys "deviceId:interfaceId" of all interfaces occupied by a link. */
export function usedPorts(data: NtbData): Set<string> {
  const used = new Set<string>()
  for (const link of Object.values(data.links)) {
    used.add(`${link.a.deviceId}:${link.a.interfaceId}`)
    used.add(`${link.b.deviceId}:${link.b.interfaceId}`)
  }
  return used
}

/** First free interface of a device whose media group matches, or null. */
export function firstFreePort(
  data: NtbData,
  deviceId: string,
  group: MediaGroup,
  used: Set<string>,
) {
  const interfaces = data.devices[deviceId]?.interfaces ?? []
  const free = interfaces.filter(
    (i) =>
      !used.has(`${deviceId}:${i.id}`) &&
      mediaGroup(i.media) === group &&
      i.media !== 'logical' && // logical ports don't take physical links
      i.media !== 'console',
  )
  return free[0] ?? null
}
