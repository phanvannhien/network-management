import type { NtbProjectFile } from '../types/ntb'
import type { NtbData } from './types'
import { emptyData } from './types'

/** Converts a .ntb.json document into in-app keyed state. */
export function fromNtbProjectFile(file: NtbProjectFile): NtbData {
  const data = emptyData()
  data.project = file.project
  for (const v of file.vlans ?? []) data.vlans[v.id] = v
  for (const s of file.subnets ?? []) data.subnets[s.id] = s
  for (const d of file.devices ?? []) data.devices[d.id] = d
  for (const l of file.links ?? []) data.links[l.id] = l
  for (const g of file.groups ?? []) data.groups[g.id] = g
  for (const a of file.assets ?? []) data.assets[a.id] = a
  for (const p of file.pages ?? []) data.pages[p.id] = p
  data.pageOrder = (file.pages ?? []).map((p) => p.id)
  return data
}

/** Converts in-app keyed state back into a .ntb.json document. */
export function toNtbProjectFile(data: NtbData): NtbProjectFile {
  const orderedPages = data.pageOrder.map((id) => data.pages[id]).filter((p) => p !== undefined)
  // Pages present in the map but missing from pageOrder keep their insertion order at the end.
  const unordered = Object.values(data.pages).filter((p) => !data.pageOrder.includes(p.id))
  return {
    schemaVersion: '1.0.0',
    project: data.project,
    vlans: Object.values(data.vlans),
    subnets: Object.values(data.subnets),
    devices: Object.values(data.devices),
    links: Object.values(data.links),
    groups: Object.values(data.groups),
    assets: Object.values(data.assets),
    pages: [...orderedPages, ...unordered],
  }
}
