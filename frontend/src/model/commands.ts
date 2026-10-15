import type { Draft } from 'immer'
import type { Device, Interface, Link, Page, Vlan } from '../types/ntb'
import type { NtbData } from './types'
import { newId } from './factory'
import { nextHostname } from '../catalog/hostname'

/**
 * A command mutates the model draft inside dispatch(). Undo/redo works by
 * snapshotting the previous immutable state, so a command does not need its
 * own inverse. Commands that repeat rapidly (e.g. dragging) share a mergeKey:
 * consecutive dispatches with the same mergeKey collapse into one undo step.
 */
export interface Command {
  apply(draft: Draft<NtbData>): void
  mergeKey?: string
}

export function addPage(page: Page): Command {
  return {
    apply(draft) {
      if (draft.pages[page.id]) throw new Error(`page already exists: ${page.id}`)
      draft.pages[page.id] = page
      draft.pageOrder.push(page.id)
    },
  }
}

export function addDevice(device: Device, pageId: string, x: number, y: number): Command {
  return {
    apply(draft) {
      if (draft.devices[device.id]) throw new Error(`device already exists: ${device.id}`)
      draft.devices[device.id] = device
      const page = draft.pages[pageId]
      if (!page) throw new Error(`page not found: ${pageId}`)
      page.nodes.push({ refId: device.id, x, y, iconAssetId: null, locked: false })
    },
  }
}

export function updateDevice(
  id: string,
  patch: Partial<Omit<Device, 'id' | 'interfaces'>>,
): Command {
  return {
    apply(draft) {
      const device = draft.devices[id]
      if (!device) throw new Error(`device not found: ${id}`)
      Object.assign(device, patch)
    },
  }
}

export function updateInterface(
  deviceId: string,
  interfaceId: string,
  patch: Partial<Omit<Interface, 'id'>>,
): Command {
  return {
    apply(draft) {
      const iface = draft.devices[deviceId]?.interfaces.find((i) => i.id === interfaceId)
      if (!iface) throw new Error(`interface not found: ${interfaceId} on ${deviceId}`)
      Object.assign(iface, patch)
    },
  }
}

/** Deletes a device, its view nodes on every page, and every link attached to it. */
export function deleteDevice(id: string): Command {
  return {
    apply(draft) {
      if (!draft.devices[id]) throw new Error(`device not found: ${id}`)
      const attachedLinks = Object.values(draft.links).filter(
        (l) => l.a.deviceId === id || l.b.deviceId === id,
      )
      for (const link of attachedLinks) deleteLink(link.id).apply(draft)
      delete draft.devices[id]
      for (const page of Object.values(draft.pages)) {
        page.nodes = page.nodes.filter((n) => n.refId !== id)
      }
    },
  }
}

export function addLink(link: Link): Command {
  return {
    apply(draft) {
      assertPortsFree(draft, link)
      draft.links[link.id] = link
    },
  }
}

export function deleteLink(id: string): Command {
  return {
    apply(draft) {
      const link = draft.links[id]
      if (!link) throw new Error(`link not found: ${id}`)
      delete draft.links[id]
      for (const page of Object.values(draft.pages)) {
        page.edges = page.edges.filter((e) => e.refId !== id)
      }
    },
  }
}

export function setNodePosition(
  pageId: string,
  refId: string,
  x: number,
  y: number,
  mergeKey?: string,
): Command {
  return {
    mergeKey,
    apply(draft) {
      const node = draft.pages[pageId]?.nodes.find((n) => n.refId === refId)
      if (!node) throw new Error(`node not found: ${refId} on page ${pageId}`)
      node.x = x
      node.y = y
    },
  }
}

export function addVlan(vlan: Vlan): Command {
  return {
    apply(draft) {
      if (draft.vlans[vlan.id]) throw new Error(`vlan already exists: ${vlan.id}`)
      if (Object.values(draft.vlans).some((v) => v.vlanId === vlan.vlanId)) {
        throw new Error(`vlan id ${vlan.vlanId} already in use`)
      }
      draft.vlans[vlan.id] = vlan
    },
  }
}

export function deleteVlan(id: string): Command {
  return {
    apply(draft) {
      if (!draft.vlans[id]) throw new Error(`vlan not found: ${id}`)
      delete draft.vlans[id]
    },
  }
}

/** Throws when either endpoint interface is already occupied by another link. */
function assertPortsFree(data: Draft<NtbData>, link: Link): void {
  for (const existing of Object.values(data.links)) {
    if (existing.id === link.id) continue
    for (const end of [link.a, link.b]) {
      const taken =
        (existing.a.deviceId === end.deviceId && existing.a.interfaceId === end.interfaceId) ||
        (existing.b.deviceId === end.deviceId && existing.b.interfaceId === end.interfaceId)
      if (taken) {
        throw new Error(`interface ${end.interfaceId} of device ${end.deviceId} is already linked`)
      }
    }
  }
}

/** Combines several commands into one undo step. */
export function compound(...commands: Command[]): Command {
  return {
    apply(draft) {
      for (const command of commands) command.apply(draft)
    },
  }
}

/** Deletes several devices (cascade links) in a single undo step. */
export function deleteDevices(ids: string[]): Command {
  return {
    apply(draft) {
      for (const id of ids) {
        if (draft.devices[id]) deleteDevice(id).apply(draft)
      }
    },
  }
}

export function setNodeLocked(pageId: string, refId: string, locked: boolean): Command {
  return {
    apply(draft) {
      const node = draft.pages[pageId]?.nodes.find((n) => n.refId === refId)
      if (!node) throw new Error(`node not found: ${refId} on page ${pageId}`)
      node.locked = locked
    },
  }
}

export interface PasteResult {
  command: Command
  newDeviceIds: string[]
}

/**
 * Builds a paste/duplicate command: copies the given devices with fresh ids,
 * renames conflicting hostnames, offsets their nodes, and re-creates internal
 * links (both endpoints inside the selection) with remapped interfaces.
 * Everything lands in a single undo step.
 */
export function buildPasteCommand(
  data: NtbData,
  pageId: string,
  deviceIds: string[],
  dx: number,
  dy: number,
): PasteResult {
  const sources = deviceIds.map((id) => data.devices[id]).filter((d) => d !== undefined)
  const copies = sources.map((device) => ({
    ...device,
    id: newId(),
    // Hostname is assigned inside apply() so consecutive copies don't collide.
    hostname: device.hostname,
    interfaces: device.interfaces.map((iface) => ({ ...iface, id: newId() })),
  }))
  const deviceIdMap = new Map(sources.map((d, i) => [d.id, copies[i].id]))
  const interfaceIdMap = new Map<string, string>()
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources[i].interfaces.length; j++) {
      interfaceIdMap.set(sources[i].interfaces[j].id, copies[i].interfaces[j].id)
    }
  }

  const internalLinks = Object.values(data.links).filter(
    (l) => deviceIdMap.has(l.a.deviceId) && deviceIdMap.has(l.b.deviceId),
  )
  const linkCopies = internalLinks.map((link) => ({
    ...link,
    id: newId(),
    a: remap(link.a),
    b: remap(link.b),
  }))

  function remap(end: { deviceId: string; interfaceId: string }) {
    return {
      deviceId: deviceIdMap.get(end.deviceId)!,
      interfaceId: interfaceIdMap.get(end.interfaceId)!,
    }
  }

  const nodePositions = new Map(
    (data.pages[pageId]?.nodes ?? [])
      .filter((n) => deviceIdMap.has(n.refId))
      .map((n) => [n.refId, { x: n.x + dx, y: n.y + dy }]),
  )

  const command: Command = {
    apply(draft) {
      for (let i = 0; i < copies.length; i++) {
        const copy = {
          ...copies[i],
          // The original keeps its hostname, so the copy always conflicts → rename.
          hostname: nextHostname(draft, sources[i].type),
        }
        draft.devices[copy.id] = copy as Draft<Device>
        const position = nodePositions.get(sources[i].id) ?? { x: 0, y: 0 }
        draft.pages[pageId].nodes.push({
          refId: copy.id,
          x: position.x,
          y: position.y,
          iconAssetId: null,
          locked: false,
        })
      }
      for (const link of linkCopies) {
        draft.links[link.id] = link as Draft<Link>
        draft.pages[pageId].edges.push({ refId: link.id, routing: 'orthogonal', waypoints: [] })
      }
    },
  }

  return { command, newDeviceIds: copies.map((c) => c.id) }
}

/** Registers a link on a page so the canvas draws it. */
export function addPageEdge(pageId: string, linkId: string): Command {
  return {
    apply(draft) {
      const page = draft.pages[pageId]
      if (!page) throw new Error(`page not found: ${pageId}`)
      if (!draft.links[linkId]) throw new Error(`link not found: ${linkId}`)
      page.edges.push({ refId: linkId, routing: 'orthogonal', waypoints: [] })
    },
  }
}

/**
 * Full "connect two ports" action: creates the link (port-conflict checked)
 * and registers the view edge — a single undo step.
 */
export function connectPorts(
  pageId: string,
  a: { deviceId: string; interfaceId: string },
  b: { deviceId: string; interfaceId: string },
  kind: Link['kind'],
): Command {
  const link: Link = {
    id: newId(),
    kind,
    status: 'planned',
    notes: '',
    a,
    b,
  }
  return compound(addLink(link), addPageEdge(pageId, link.id))
}

export function updateLink(id: string, patch: Partial<Omit<Link, 'id' | 'a' | 'b'>>): Command {
  return {
    apply(draft) {
      const link = draft.links[id]
      if (!link) throw new Error(`link not found: ${id}`)
      Object.assign(link, patch)
    },
  }
}

/** Applies the same device patch to many devices in one undo step (bulk edit). */
export function updateDevicesBulk(
  ids: string[],
  patch: Partial<Omit<Device, 'id' | 'interfaces'>>,
): Command {
  return {
    apply(draft) {
      for (const id of ids) {
        const device = draft.devices[id]
        if (!device) throw new Error(`device not found: ${id}`)
        Object.assign(device, patch)
      }
    },
  }
}

/** Replaces the whole document (Load file / restore session) in one undo step. */
export function replaceDocument(next: NtbData): Command {
  return {
    apply(draft) {
      draft.project = next.project
      draft.vlans = next.vlans
      draft.subnets = next.subnets
      draft.devices = next.devices
      draft.links = next.links
      draft.groups = next.groups
      draft.assets = next.assets
      draft.pages = next.pages
      draft.pageOrder = [...next.pageOrder]
    },
  }
}
