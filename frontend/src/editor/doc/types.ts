import type { components } from '@/api/client'
import type { PendingPort } from '../library/ports'
import type { DiagramGateway, DiagramVlan, PortL2 } from '../l2/l2'

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
export type EndpointGroupInput = components['schemas']['EndpointGroupInput']
export type EndpointGroupUpdate = components['schemas']['EndpointGroupUpdate']

/** An endpoint group on the diagram (ADR-036): stands for many alike endpoints, not in the device list. */
export interface GroupCard {
  id: string
  name: string
  kind: EndpointGroup['kind']
  siteId: string
  expectedCount: number | null
  ipRangeId: string | null
  /** e.g. "10.1.20.10–10.1.20.60" when a range is linked. */
  range: string
  notes: string
  /** Created in this editor and not saved yet. */
  draft?: boolean
}
export type Link = components['schemas']['Link']
export type LinkInput = components['schemas']['LinkInput']
export type LinkUpdate = components['schemas']['LinkUpdate']

/** What the editor needs to draw a device; new devices only have what the form gave. */
export interface DeviceCard {
  id: string
  hostname: string
  type: Device['type']
  siteId: string
  /** Cluster (stack / HA pair) of the device: a cable between members suggests "stack". */
  clusterId?: string | null
  clusterName?: string
  /** ha_active_passive, stack… (the cluster box label). */
  clusterKind?: string
  /** Management IP (with prefix), shown under the hostname (SRS §6.3 label {hostname}\n{mgmtIp}). */
  mgmtIp?: string
  model?: string
  siteCode?: string
  /** false = someone else's box on our site (ISP modem…): dashed border (SRS §6.3). */
  managed?: boolean
  /** Created in the editor, not saved yet. */
  draft?: boolean
  /** Library model and part number (product photo, P2-12). */
  catalogId?: string
  partNumber?: string
  /** active, planned… and the vendor end-of-support date (check "support ended", P2-22). */
  lifecycle?: Device['lifecycle']
  eosDate?: string | null
}

export interface LinkCard {
  id: string
  aId: string
  bId: string
  kind: Link['kind']
  aPort: string
  bPort: string
  /** Design status (Phase 3 adds the live one from monitoring). */
  status?: Link['status']
  draft?: boolean
  /** Switchport facts of each end for the L2 view (P2-08); none on a cable drawn and not saved yet. */
  aL2?: PortL2
  bL2?: PortL2
}

export interface DocState {
  view: DiagramView
  devices: Record<string, DeviceCard>
  groups: Record<string, GroupCard>
  links: Record<string, LinkCard>
  /** Ids the caller may not see: kept on the view untouched. */
  hidden: string[]
  /** L2 view (P2-08): VLAN names / colours of the sites on the view, and where VLANs are routed. Read-only facts. */
  vlans?: DiagramVlan[]
  gateways?: DiagramGateway[]
  /**
   * Off-page connectors (P2-08): links with one end on the diagram and the other off it, the far ends (what they are,
   * to name them or place them here) and the other diagrams placing them. Read-only facts.
   */
  external?: Record<string, LinkCard>
  farEnds?: Record<string, FarEnd>
  elsewhere?: Record<string, { id: string; name: string }[]>
  /** L3 pages (P2-08): subnets, where device IPs sit, endpoint groups' subnets — derived from IPAM, read-only. */
  l3?: L3Facts
  // Pending inventory changes, in creation order where order matters (create before link).
  newDevices: Record<string, DeviceInput>
  newDeviceOrder: string[]
  /** Ports a pending device will get from its template (temp ids), so cables can name them before the save. */
  newPorts?: Record<string, PendingPort[]>
  deviceEdits: Record<string, DeviceUpdate>
  deletedDevices: string[]
  newLinks: Record<string, LinkInput>
  newLinkOrder: string[]
  linkEdits: Record<string, LinkUpdate>
  deletedLinks: string[]
  /** Endpoint groups drawn in this editor (ADR-036), saved with the diagram; optional for older drafts. */
  newGroups?: Record<string, EndpointGroupInput>
  newGroupOrder?: string[]
  groupEdits?: Record<string, EndpointGroupUpdate>
}

export type DiagramSubnet = components['schemas']['DiagramSubnet']
export type DiagramAttachment = components['schemas']['DiagramAttachment']

export interface L3Facts {
  subnets: Record<string, DiagramSubnet>
  attachments: DiagramAttachment[]
  /** Endpoint group id → subnet id (of its IP range). */
  groupSubnet: Record<string, string>
}

/** The end of an external link that is not on the diagram. */
export interface FarEnd {
  id: string
  kind: 'device' | 'endpoint_group'
  name: string
  type: string
  siteId: string
  siteCode: string
}

export function linkCard(l: Link): LinkCard {
  return {
    id: l.id,
    aId: l.a.id,
    bId: l.b.id,
    kind: l.kind,
    aPort: l.a.interfaceName,
    bPort: l.b.interfaceName,
    status: l.status,
    aL2: portL2(l.a),
    bL2: portL2(l.b),
  }
}

function portL2(e: Link['a']): PortL2 | undefined {
  if (!e.interfaceId) return undefined
  return {
    mode: e.interfaceMode,
    access: e.accessVlan ?? null,
    native: e.nativeVlan ?? null,
    allowed: e.allowedVlans,
    lagId: e.lagId ?? null,
    lagName: e.lagName,
  }
}

export function groupCard(g: EndpointGroup): GroupCard {
  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    siteId: g.siteId,
    expectedCount: g.expectedCount ?? null,
    ipRangeId: g.ipRangeId ?? null,
    range: g.rangeStart && g.rangeEnd ? `${g.rangeStart}–${g.rangeEnd}` : '',
    notes: g.notes,
  }
}

export function emptyView(): DiagramView {
  return { nodes: [], edges: [], annotations: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

export function docFromDetail(d: DiagramDetail): DocState {
  const devices: DocState['devices'] = {}
  for (const x of d.devices)
    devices[x.id] = {
      id: x.id,
      hostname: x.hostname,
      type: x.type,
      siteId: x.siteId,
      clusterId: x.clusterId ?? null,
      clusterName: x.clusterName,
      clusterKind: x.clusterKind,
      mgmtIp: x.mgmtIp,
      model: x.model,
      siteCode: x.siteCode,
      managed: x.managed,
      catalogId: x.catalogId,
      partNumber: x.partNumber,
      lifecycle: x.lifecycle,
      eosDate: x.eosDate ?? null,
    }
  const groups: DocState['groups'] = {}
  for (const g of d.endpointGroups) groups[g.id] = groupCard(g)
  const links: DocState['links'] = {}
  for (const l of d.links) links[l.id] = linkCard(l)
  // The inventory is the source of truth (ADR-015): a link between two objects on the view is always drawn, even if
  // it was made outside this diagram; the view only adds routing for it.
  const onView = new Set((d.view.nodes ?? []).map((n) => n.refId))
  // Edges of cables deleted since the last save are dropped too.
  const known = new Set(d.links.map((l) => l.id))
  const edges = (d.view.edges ?? []).filter((e) => known.has(e.linkId))
  const drawn = new Set(edges.map((e) => e.linkId))
  for (const l of d.links)
    if (!drawn.has(l.id) && onView.has(l.a.id) && onView.has(l.b.id))
      edges.push({ id: `e-${l.id}`, linkId: l.id })
  // Objects deleted from the inventory since the diagram was saved are dropped from the view (ADR-032: hidden refs
  // only mean "gone" now); the next save stores the cleaned view.
  const gone = new Set(d.hiddenRefs)
  return {
    view: {
      ...emptyView(),
      ...d.view,
      nodes: (d.view.nodes ?? []).filter((n) => !gone.has(n.refId)),
      edges,
      annotations: d.view.annotations ?? [],
    },
    devices,
    groups,
    links,
    hidden: d.hiddenRefs,
    vlans: d.vlans ?? [],
    gateways: d.gateways ?? [],
    ...externalFacts(d),
    l3: {
      subnets: Object.fromEntries((d.l3?.subnets ?? []).map((x) => [x.id, x])),
      attachments: d.l3?.attachments ?? [],
      groupSubnet: Object.fromEntries((d.l3?.groups ?? []).map((g) => [g.groupId, g.subnetId])),
    },
    newDevices: {},
    newDeviceOrder: [],
    newPorts: {},
    deviceEdits: {},
    deletedDevices: [],
    newLinks: {},
    newLinkOrder: [],
    linkEdits: {},
    deletedLinks: [],
    newGroups: {},
    newGroupOrder: [],
    groupEdits: {},
  }
}

/** Pending inventory changes in a safe order: creates, then updates, then link changes, then deletes. */
export function changesOf(doc: DocState): DiagramChange[] {
  const out: DiagramChange[] = []
  for (const id of doc.newDeviceOrder) {
    const device = doc.newDevices[id]
    if (!device) continue
    // Drafts from before P1-17 have no newPorts.
    const ports = doc.newPorts?.[id] ?? []
    out.push(
      ports.length > 0 && device.templateId
        ? {
            op: 'createDevice',
            tempId: id,
            device,
            portTempIds: ports.map((p) => ({ name: p.name, tempId: p.id })),
          }
        : { op: 'createDevice', tempId: id, device },
    )
  }
  for (const [id, u] of Object.entries(doc.deviceEdits))
    out.push({ op: 'updateDevice', id, deviceUpdate: u })
  // Groups before the cables that end on them.
  for (const id of doc.newGroupOrder ?? []) {
    const g = doc.newGroups?.[id]
    if (g) out.push({ op: 'createEndpointGroup', tempId: id, endpointGroup: g })
  }
  for (const [id, u] of Object.entries(doc.groupEdits ?? {}))
    out.push({ op: 'updateEndpointGroup', id, endpointGroupUpdate: u })
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

/** React Flow id prefix of annotations (frames, text, arrows), apart from view node ids. */
export const ANN = 'a:'

/** External links, their far ends and where else those are drawn (off-page connectors, P2-08). */
function externalFacts(d: DiagramDetail): Pick<DocState, 'external' | 'farEnds' | 'elsewhere'> {
  const external: Record<string, LinkCard> = {}
  const farEnds: Record<string, FarEnd> = {}
  const onView = new Set((d.view.nodes ?? []).map((n) => n.refId))
  for (const l of d.externalLinks ?? []) {
    external[l.id] = linkCard(l)
    for (const e of [l.a, l.b])
      if (!onView.has(e.id))
        farEnds[e.id] = {
          id: e.id,
          kind: e.kind,
          name: e.name,
          type: e.type,
          siteId: e.siteId,
          siteCode: e.siteCode,
        }
  }
  const elsewhere: Record<string, { id: string; name: string }[]> = {}
  for (const w of d.elsewhere ?? []) elsewhere[w.refId] = w.diagrams
  return { external, farEnds, elsewhere }
}
