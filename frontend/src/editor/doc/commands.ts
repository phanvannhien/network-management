import type { PendingPort } from '../library/ports'
import type {
  DeviceCard,
  LinkCard,
  DeviceInput,
  DeviceUpdate,
  DocState,
  LinkInput,
  LinkUpdate,
} from './types'

// Editor commands (P1-13): every change to the document goes through one, so undo / redo covers the view and the
// pending inventory changes alike. `mergeKey` folds a stream of small steps (a drag) into one undo entry.

export interface DocCommand {
  label: string
  mergeKey?: string
  apply(draft: DocState): void
}

export function newId(): string {
  return crypto.randomUUID()
}

function nodeIdsOf(draft: DocState, refId: string): string[] {
  return draft.view.nodes.filter((n) => n.refId === refId).map((n) => n.id)
}

/** Links whose both ends are still on the view keep their edges; the others lose them. */
function pruneEdges(draft: DocState) {
  const onView = new Set(draft.view.nodes.map((n) => n.refId))
  draft.view.edges = draft.view.edges.filter((e) => {
    const l = draft.links[e.linkId]
    // A hidden link (unknown to us) stays as it was.
    return !l || (onView.has(l.aId) && onView.has(l.bId))
  })
}

/** Place an inventory object on the diagram; `device` carries what the editor needs to draw it. */
export function addNode(
  refKind: 'device' | 'endpoint_group' | 'site' | 'diagram',
  refId: string,
  x: number,
  y: number,
  opts: {
    id?: string
    device?: DeviceCard
    group?: DocState['groups'][string]
    links?: LinkCard[]
  } = {},
): DocCommand {
  const id = opts.id ?? newId()
  return {
    label: 'addNode',
    apply(d) {
      if (d.view.nodes.some((n) => n.refId === refId && n.refKind === refKind)) return
      if (opts.device && !d.devices[refId]) d.devices[refId] = opts.device
      if (opts.group && !d.groups[refId]) d.groups[refId] = opts.group
      // Inventory links of the object (ADR-015): those to objects on the view get drawn below.
      for (const l of opts.links ?? [])
        if (!d.links[l.id] && !d.deletedLinks.includes(l.id)) d.links[l.id] = l
      d.view.nodes.push({ id, refKind, refId, x, y })
      // Known links between this object and others on the view get an edge.
      const onView = new Set(d.view.nodes.map((n) => n.refId))
      const drawn = new Set(d.view.edges.map((e) => e.linkId))
      for (const l of Object.values(d.links))
        if (!drawn.has(l.id) && onView.has(l.aId) && onView.has(l.bId))
          d.view.edges.push({ id: newId(), linkId: l.id })
    },
  }
}

/** Move nodes to absolute positions; a drag sends many of these with one mergeKey. */
export function moveNodes(
  moves: { id: string; x: number; y: number }[],
  mergeKey?: string,
): DocCommand {
  return {
    label: 'moveNodes',
    mergeKey,
    apply(d) {
      // Index once: a drag of many selected nodes must not scan the view per node.
      const byId = new Map(d.view.nodes.map((n) => [n.id, n]))
      for (const m of moves) {
        const n = byId.get(m.id)
        if (n && !n.locked && (n.x !== m.x || n.y !== m.y)) {
          n.x = m.x
          n.y = m.y
        }
      }
    },
  }
}

/** Remove nodes from the diagram only (the inventory keeps them, SRS §6.4 Delete); locked nodes stay. */
export function removeNodes(nodeIds: string[]): DocCommand {
  return {
    label: 'removeNodes',
    apply(d) {
      const drop = new Set(nodeIds)
      for (const n of d.view.nodes) if (n.locked) drop.delete(n.id)
      if (drop.size === 0) return
      d.view.nodes = d.view.nodes.filter((n) => !drop.has(n.id))
      pruneEdges(d)
    },
  }
}

/** A device created in the editor: kept as a pending create and drawn at once. */
export function createDevice(
  input: DeviceInput,
  x: number,
  y: number,
  tempId = newId(),
  nodeId = newId(),
  ports: PendingPort[] = [],
): DocCommand {
  return {
    label: 'createDevice',
    apply(d) {
      d.newDevices[tempId] = input
      d.newDeviceOrder.push(tempId)
      if (ports.length > 0) {
        d.newPorts ??= {}
        d.newPorts[tempId] = ports
      }
      d.devices[tempId] = {
        id: tempId,
        hostname: input.hostname,
        type: input.type,
        siteId: input.siteId,
        draft: true,
      }
      d.view.nodes.push({ id: nodeId, refKind: 'device', refId: tempId, x, y })
    },
  }
}

/** Edit a device: a pending create is edited in place, a saved one gets a full update body. */
export function updateDevice(id: string, update: DeviceUpdate): DocCommand {
  return {
    label: 'updateDevice',
    apply(d) {
      const { version: _v, ...input } = update
      if (d.newDevices[id]) d.newDevices[id] = input as DeviceInput
      else d.deviceEdits[id] = update
      const card = d.devices[id]
      if (card)
        Object.assign(card, { hostname: update.hostname, type: update.type, siteId: update.siteId })
    },
  }
}

/** Delete a device from the inventory (Shift+Delete): its nodes, links and pending edits go too. */
export function deleteDevice(id: string): DocCommand {
  return {
    label: 'deleteDevice',
    apply(d) {
      if (d.newDevices[id]) {
        delete d.newDevices[id]
        if (d.newPorts) delete d.newPorts[id]
        d.newDeviceOrder = d.newDeviceOrder.filter((x) => x !== id)
      } else if (!d.deletedDevices.includes(id)) d.deletedDevices.push(id)
      delete d.deviceEdits[id]
      delete d.devices[id]
      for (const l of Object.values(d.links)) {
        if (l.aId !== id && l.bId !== id) continue
        // The server deletes saved links with the device; only pending ones need dropping here.
        delete d.newLinks[l.id]
        d.newLinkOrder = d.newLinkOrder.filter((x) => x !== l.id)
        delete d.linkEdits[l.id]
        delete d.links[l.id]
      }
      const drop = new Set(nodeIdsOf(d, id))
      d.view.nodes = d.view.nodes.filter((n) => !drop.has(n.id))
      d.view.edges = d.view.edges.filter((e) => d.links[e.linkId] || d.hidden.includes(e.linkId))
    },
  }
}

/** Port names shown at the cable ends (the input only carries interface ids). */
export interface PortNames {
  aPort: string
  bPort: string
}

export function createLink(
  input: LinkInput,
  tempId = newId(),
  ports: PortNames = { aPort: '', bPort: '' },
): DocCommand {
  return {
    label: 'createLink',
    apply(d) {
      d.newLinks[tempId] = input
      d.newLinkOrder.push(tempId)
      d.links[tempId] = {
        id: tempId,
        aId: input.a.id,
        bId: input.b.id,
        kind: input.kind,
        ...ports,
        status: input.status ?? 'up',
        draft: true,
      }
      d.view.edges.push({ id: newId(), linkId: tempId })
    },
  }
}

export function updateLink(id: string, update: LinkUpdate, ports?: PortNames): DocCommand {
  return {
    label: 'updateLink',
    apply(d) {
      const { version: _v, ...input } = update
      if (d.newLinks[id]) d.newLinks[id] = input as LinkInput
      else d.linkEdits[id] = update
      const card = d.links[id]
      if (card)
        Object.assign(card, {
          aId: update.a.id,
          bId: update.b.id,
          kind: update.kind,
          status: update.status ?? card.status,
          ...ports,
        })
    },
  }
}

export function deleteLink(id: string): DocCommand {
  return {
    label: 'deleteLink',
    apply(d) {
      if (d.newLinks[id]) {
        delete d.newLinks[id]
        d.newLinkOrder = d.newLinkOrder.filter((x) => x !== id)
      } else if (!d.deletedLinks.includes(id)) d.deletedLinks.push(id)
      delete d.linkEdits[id]
      delete d.links[id]
      d.view.edges = d.view.edges.filter((e) => e.linkId !== id)
    },
  }
}

/** Several commands as one undo step (paste, duplicate, delete of a selection). */
export function compound(label: string, commands: DocCommand[]): DocCommand {
  return {
    label,
    apply(d) {
      for (const c of commands) c.apply(d)
    },
  }
}

/** Lock or unlock nodes: a locked node does not move and is not removed by Delete. */
export function setLocked(nodeIds: string[], locked: boolean): DocCommand {
  return {
    label: 'setLocked',
    apply(d) {
      const ids = new Set(nodeIds)
      for (const n of d.view.nodes)
        if (ids.has(n.id) && Boolean(n.locked) !== locked) {
          if (locked) n.locked = true
          else delete n.locked
        }
    },
  }
}
