import type { DocState } from '../doc/types'
import { l2Of, namedVids, vlanInfo, type VlanInfo } from './l2'

/** Cables the L2 view leaves out (same as the canvas). */
const NOT_L2: ReadonlySet<string> = new Set(['power', 'console', 'stack'])

interface LegendItem extends VlanInfo {
  /** Site code when two VLAN records share a number on this diagram. */
  where: string
  gateway: boolean
}

/**
 * The VLANs the cables on the diagram name, as VLAN records (VLAN 20 of HCM and VLAN 20 of HN are two rows when IPAM
 * has both). Each end is read from its own site.
 */
export function legendItems(doc: DocState): LegendItem[] {
  const vlans = doc.vlans ?? []
  const onView = new Set(doc.view.nodes.map((n) => n.refId))
  const siteOf = (id: string) => doc.devices[id]?.siteId ?? doc.groups[id]?.siteId
  const byKey = new Map<string, LegendItem>()
  const add = (vid: number, siteId: string | undefined, gateway = false) => {
    const v = vlanInfo(vid, siteId, vlans)
    const cur = byKey.get(v.key)
    if (cur) cur.gateway ||= gateway
    else byKey.set(v.key, { ...v, where: '', gateway })
  }
  for (const l of Object.values(doc.links)) {
    if (NOT_L2.has(l.kind) || !onView.has(l.aId) || !onView.has(l.bId)) continue
    const vids = namedVids(l2Of(l))
    for (const vid of vids) {
      add(vid, siteOf(l.aId))
      if (siteOf(l.bId) !== siteOf(l.aId)) add(vid, siteOf(l.bId))
    }
  }
  for (const g of doc.gateways ?? [])
    if (onView.has(g.deviceId)) add(g.vid, g.siteId ?? undefined, true)
  const items = [...byKey.values()].sort((a, b) => a.vid - b.vid || a.key.localeCompare(b.key))
  const count = new Map<number, number>()
  for (const i of items) count.set(i.vid, (count.get(i.vid) ?? 0) + 1)
  const codeOf = (siteId: string) =>
    Object.values(doc.devices).find((d) => d.siteId === siteId)?.siteCode ?? ''
  for (const i of items)
    if ((count.get(i.vid) ?? 0) > 1) {
      const site = i.key.slice(0, i.key.lastIndexOf(':'))
      i.where = site === 'org' || site === '?' ? '' : codeOf(site)
    }
  return items
}
