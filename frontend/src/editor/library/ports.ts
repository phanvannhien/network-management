import type { components } from '@/api/client'
import { newId } from '../doc/commands'

// Ports a template will generate (P1-17), so a device placed or cloned in the editor can be cabled port to port before
// the diagram is saved. Mirrors backend expandPorts: "Gi{m}/0/{n}" from start, count; {m} = stack member (1 here).

type PortGroup = components['schemas']['PortGroup']

export interface PendingPort {
  /** Client temp id; the save maps it to the real interface id (DiagramChange.portTempIds). */
  id: string
  name: string
  kind: 'physical'
  media: string
  speed: string
  poe: boolean
}

export function expandTemplatePorts(groups: PortGroup[], member = 1): PendingPort[] {
  const out: PendingPort[] = []
  const seen = new Set<string>()
  for (const g of groups) {
    for (let n = g.start; n < g.start + g.count; n++) {
      const name = g.pattern.trim().replaceAll('{n}', String(n)).replaceAll('{m}', String(member))
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: newId(),
        name,
        kind: 'physical',
        media: g.media ?? '',
        speed: g.speed?.trim() ?? '',
        poe: g.poe ?? false,
      })
    }
  }
  return out
}
