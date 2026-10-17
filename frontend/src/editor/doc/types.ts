import type { components } from '@/api/client'

// The diagram document the editor works on (P1-13, ADR-015): the stored view plus the inventory it shows, and the
// inventory changes made in the editor that are not saved yet. Everything here is undoable; saving sends the view and
// the pending changes in one request.

export type DiagramView = components['schemas']['DiagramView']
export type DiagramNode = components['schemas']['DiagramNode']
export type DiagramEdge = components['schemas']['DiagramEdge']
export type DiagramViewport = components['schemas']['DiagramViewport']
export type DiagramDetail = components['schemas']['DiagramDetail']
export type DiagramMeta = components['schemas']['Diagram']
export type DiagramSave = components['schemas']['DiagramSave']
export type DiagramChange = components['schemas']['DiagramChange']
export type DiagramSaveResult = components['schemas']['DiagramSaveResult']
export type Device = components['schemas']['Device']
export type DeviceInput = components['schemas']['DeviceInput']
export type DeviceUpdate = components['schemas']['DeviceUpdate']
export type EndpointGroup = components['schemas']['EndpointGroup']
export type Link = components['schemas']['Link']
export type LinkInput = components['schemas']['LinkInput']
export type LinkUpdate = components['schemas']['LinkUpdate']

/** What the editor needs to draw a device; new devices only have what the form gave. */
export interface DeviceCard {
  id: string
  hostname: string
  type: Device['type']
  siteId: string
  /** Created in the editor, not saved yet. */
  draft?: boolean
}

export interface LinkCard {
  id: string
  aId: string
  bId: string
  kind: Link['kind']
  aPort: string
  bPort: string
  draft?: boolean
}

export interface DocState {
  view: DiagramView
  devices: Record<string, DeviceCard>
  groups: Record<string, { id: string; name: string; kind: EndpointGroup['kind'] }>
  links: Record<string, LinkCard>
  /** Ids the caller may not see: kept on the view untouched. */
  hidden: string[]
  // Pending inventory changes, in creation order where order matters (create before link).
  newDevices: Record<string, DeviceInput>
  newDeviceOrder: string[]
  deviceEdits: Record<string, DeviceUpdate>
  deletedDevices: string[]
  newLinks: Record<string, LinkInput>
  newLinkOrder: string[]
  linkEdits: Record<string, LinkUpdate>
  deletedLinks: string[]
}

export function emptyView(): DiagramView {
  return { nodes: [], edges: [], annotations: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

export function docFromDetail(d: DiagramDetail): DocState {
  const devices: DocState['devices'] = {}
  for (const x of d.devices)
    devices[x.id] = { id: x.id, hostname: x.hostname, type: x.type, siteId: x.siteId }
  const groups: DocState['groups'] = {}
  for (const g of d.endpointGroups) groups[g.id] = { id: g.id, name: g.name, kind: g.kind }
  const links: DocState['links'] = {}
  for (const l of d.links)
    links[l.id] = {
      id: l.id,
      aId: l.a.id,
      bId: l.b.id,
      kind: l.kind,
      aPort: l.a.interfaceName,
      bPort: l.b.interfaceName,
    }
  // The inventory is the source of truth (ADR-015): a link between two objects on the view is always drawn, even if
  // it was made outside this diagram; the view only adds routing for it.
  const onView = new Set((d.view.nodes ?? []).map((n) => n.refId))
  const edges = [...(d.view.edges ?? [])]
  const drawn = new Set(edges.map((e) => e.linkId))
  for (const l of d.links)
    if (!drawn.has(l.id) && onView.has(l.a.id) && onView.has(l.b.id))
      edges.push({ id: `e-${l.id}`, linkId: l.id })
  return {
    view: {
      ...emptyView(),
      ...d.view,
      nodes: d.view.nodes ?? [],
      edges,
      annotations: d.view.annotations ?? [],
    },
    devices,
    groups,
    links,
    hidden: d.hiddenRefs,
    newDevices: {},
    newDeviceOrder: [],
    deviceEdits: {},
    deletedDevices: [],
    newLinks: {},
    newLinkOrder: [],
    linkEdits: {},
    deletedLinks: [],
  }
}

/** Pending inventory changes in a safe order: creates, then updates, then link changes, then deletes. */
export function changesOf(doc: DocState): DiagramChange[] {
  const out: DiagramChange[] = []
  for (const id of doc.newDeviceOrder)
    if (doc.newDevices[id]) out.push({ op: 'createDevice', tempId: id, device: doc.newDevices[id] })
  for (const [id, u] of Object.entries(doc.deviceEdits))
    out.push({ op: 'updateDevice', id, deviceUpdate: u })
  for (const id of doc.deletedLinks) out.push({ op: 'deleteLink', id })
  for (const id of doc.newLinkOrder)
    if (doc.newLinks[id]) out.push({ op: 'createLink', tempId: id, link: doc.newLinks[id] })
  for (const [id, u] of Object.entries(doc.linkEdits))
    out.push({ op: 'updateLink', id, linkUpdate: u })
  for (const id of doc.deletedDevices) out.push({ op: 'deleteDevice', id })
  return out
}

export function hasChanges(doc: DocState): boolean {
  return changesOf(doc).length > 0
}
