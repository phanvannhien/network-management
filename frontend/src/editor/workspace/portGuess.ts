import type { components } from '@/api/client'

export type PortGroup = components['schemas']['PortGroup']

/**
 * Likely ports of a device that has none yet (imported without a template, P1-21), from its model: the count of
 * copper and SFP ports in names like "C1300-24T-4G" / "CBS220-24T-4G", and the vendor's usual port naming. Only a
 * proposal shown in the cable dialog — the user confirms or edits it.
 */
export function guessPorts(model = '', type = ''): PortGroup[] {
  const m = model.toUpperCase()
  if (/^ISR\s?4[34]\d\d/.test(m))
    return [g('GigabitEthernet0/0/{n}', 0, /4331|4431/.test(m) ? 3 : 2)]
  if (/^ISR\s?11\d\d/.test(m))
    return [g('GigabitEthernet0/0/{n}', 0, 2), g('GigabitEthernet0/1/{n}', 0, 8)]
  const fg = /FORTIGATE\s*(\d+)/.exec(m)
  if (fg) return [g('wan{n}', 1, 2), g('port{n}', 1, Number(fg[1]) >= 100 ? 16 : 7)]
  // "-24T-4G", "-48FP-4X", "-24P-4G": copper count, then uplinks (G = 1G SFP, X = 10G SFP+).
  const sizes = /-(\d+)[A-Z]*-(\d+)([GX])/.exec(m)
  const copper = sizes ? Number(sizes[1]) : /SWITCH/.test(type.toUpperCase()) ? 24 : 8
  const up = sizes ? Number(sizes[2]) : 0
  const upMedia = sizes?.[3] === 'X' ? 'SFP+' : 'SFP'
  const upSpeed = sizes?.[3] === 'X' ? '10G' : '1G'
  const poe = /-\d+(F?P|LP|MP)-/.test(m)
  // Catalyst / C1300 / C9x00 name ports per stack member; small business (CBS/SG) number them flat.
  const base = /^(C1[23]00|C9\d00|WS-C|C2960|C3[68]50)/.test(m)
    ? 'GigabitEthernet{m}/0/{n}'
    : /^(CBS|SG\d)/.test(m)
      ? 'GigabitEthernet{n}'
      : 'Gi{n}'
  const out = [g(base, 1, copper, 'RJ45', '1G', poe)]
  if (up > 0) out.push(g(base, copper + 1, up, upMedia, upSpeed))
  return out
}

function g(
  pattern: string,
  start: number,
  count: number,
  media = 'RJ45',
  speed = '1G',
  poe = false,
): PortGroup {
  return {
    pattern,
    start,
    count,
    media: media as PortGroup['media'],
    speed,
    ...(poe ? { poe } : {}),
  }
}

/** "24 × GigabitEthernet1/0/1–24 (RJ45 1G)". */
export function describeGroup(p: PortGroup): string {
  const name = (n: number) => p.pattern.replace('{m}', '1').replace('{n}', String(n))
  const range = p.count > 1 ? `${name(p.start)}–${p.start + p.count - 1}` : name(p.start)
  return `${p.count} × ${range} (${[p.media, p.speed].filter(Boolean).join(' ')}${p.poe ? ', PoE' : ''})`
}
