import type { components } from '@/api/client'
import {
  addNode,
  compound,
  createDevice,
  createLink,
  newId,
  type DocCommand,
} from '../doc/commands'
import type { DeviceCard, DeviceInput, DocState, LinkCard } from '../doc/types'

// Copy / paste / duplicate on the diagram (P1-16, ADR-015: the inventory is the truth; P1-16 review). One decision per
// paste: when none of the copied devices is on the target diagram, paste PLACES the same inventory objects (one device
// on many diagrams) and their cables come from the inventory; otherwise — and always for Duplicate — every copied device
// is CLONED as a new pending device, and only cables between cloned devices are cloned (never a new cable to a real
// device). Endpoint groups are never cloned (their members carry IPs).

type Device = components['schemas']['Device']
type Link = components['schemas']['Link']

export interface ClipNode {
  refKind: 'device' | 'endpoint_group'
  refId: string
  /** Offset from the top-left of the copied selection. */
  dx: number
  dy: number
  card?: DeviceCard
  /** A device created in the source diagram and not saved yet: it can only be cloned. */
  pending?: DeviceInput
}

export interface Clip {
  orgId: string
  /** Top-left of the copied selection on its diagram. */
  x: number
  y: number
  nodes: ClipNode[]
  /** Cables among the copied objects (cards; full records are fetched when cloning). */
  links: LinkCard[]
}

const KEY = 'ntb-editor-clipboard-v1'
let memory: Clip | null = null

/** In-app clipboard (not the system one, so inventory data never lands in a chat); shared by tabs of this browser. */
export const clipboard = {
  get(): Clip | null {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw) as Clip
    } catch {
      // fall back to memory
    }
    return memory
  },
  set(c: Clip) {
    memory = c
    try {
      localStorage.setItem(KEY, JSON.stringify(c))
    } catch {
      // storage blocked: memory only
    }
  },
}

/** What a selection puts on the clipboard; sites and other diagrams are not copied. */
export function copySelection(doc: DocState, selection: string[], orgId: string): Clip | null {
  const picked = doc.view.nodes.filter(
    (n) => selection.includes(n.id) && (n.refKind === 'device' || n.refKind === 'endpoint_group'),
  )
  if (picked.length === 0) return null
  const x = Math.min(...picked.map((n) => n.x))
  const y = Math.min(...picked.map((n) => n.y))
  const ids = new Set(picked.map((n) => n.refId))
  return {
    orgId,
    x,
    y,
    nodes: picked.map((n) => ({
      refKind: n.refKind as ClipNode['refKind'],
      refId: n.refId,
      dx: n.x - x,
      dy: n.y - y,
      card: doc.devices[n.refId],
      pending: doc.newDevices[n.refId],
    })),
    links: Object.values(doc.links).filter((l) => ids.has(l.aId) && ids.has(l.bId)),
  }
}

/** True when the paste must clone: Duplicate, a copied device already shown here, or one not saved yet. */
export function mustClone(doc: DocState, c: Clip, duplicate: boolean): boolean {
  if (duplicate) return true
  const onView = new Set(doc.view.nodes.map((n) => n.refId))
  return c.nodes.some((n) => n.refKind === 'device' && (onView.has(n.refId) || n.pending))
}

/**
 * Fields a clone keeps: what describes the model and where it lives — never its identity (S/N, asset tag, purchase,
 * rack position, IPs, management, cluster, notes). A copy is not installed yet: lifecycle "planned".
 */
export function cloneInput(d: Device | DeviceInput, hostname: string): DeviceInput {
  return {
    hostname,
    type: d.type,
    siteId: d.siteId,
    locationId: d.locationId ?? null,
    vendor: d.vendor,
    model: d.model,
    partNumber: d.partNumber,
    firmware: d.firmware,
    role: d.role,
    lifecycle: 'planned',
    managed: d.managed,
    tags: d.tags,
    customFields: d.customFields,
    uHeight: d.uHeight,
    ownerName: d.ownerName,
    eolDate: d.eolDate ?? null,
    eosDate: d.eosDate ?? null,
    templateId: d.templateId ?? null,
  }
}

/** Next free name: the trailing number goes up (SW01 → SW02); a name without one gets "-02"; at most 63 chars. */
export function nextFreeHostname(hostname: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((h) => h.toLowerCase()))
  const m = /^(.*?)(\d+)$/.exec(hostname)
  const stem = m ? m[1]! : `${hostname.slice(0, 60)}-`
  const width = m ? m[2]!.length : 2
  for (let n = m ? Number(m[2]) + 1 : 2; ; n++) {
    const candidate = `${stem}${String(n).padStart(width, '0')}`.slice(0, 63)
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

export interface PastePlan {
  command: DocCommand
  /** View node ids of what was pasted, to select them. */
  nodeIds: string[]
  cloned: number
  /** Endpoint groups left out of a clone. */
  skippedGroups: number
}

/**
 * Builds the paste as one undo step at `at` (top-left). `sources` holds the inventory record of every saved device
 * that gets cloned, `links` the full inventory records of the copied devices' cables, `taken` the hostnames in use.
 */
export function planPaste(
  doc: DocState,
  c: Clip,
  at: { x: number; y: number },
  opts: {
    clone: boolean
    sources: Record<string, Device>
    links: Link[]
    taken: ReadonlySet<string>
  },
): PastePlan {
  const onView = new Set(doc.view.nodes.map((n) => n.refId))
  const names = new Set(opts.taken)
  const commands: DocCommand[] = []
  const nodeIds: string[] = []
  const cloneOf = new Map<string, string>() // source device id → clone temp id
  let skippedGroups = 0
  for (const n of c.nodes) {
    const x = Math.round(at.x + n.dx)
    const y = Math.round(at.y + n.dy)
    if (opts.clone) {
      if (n.refKind !== 'device') {
        skippedGroups++
        continue
      }
      const src = n.pending ?? opts.sources[n.refId]
      if (!src || !n.card) continue
      // A provider cloud is a name on the drawing ("Internet"): repeated as it is.
      const hostname =
        src.type === 'provider_cloud' ? n.card.hostname : nextFreeHostname(n.card.hostname, names)
      names.add(hostname)
      const tempId = newId()
      const nodeId = newId()
      cloneOf.set(n.refId, tempId)
      commands.push(createDevice(cloneInput(src, hostname), x, y, tempId, nodeId))
      nodeIds.push(nodeId)
    } else if (!onView.has(n.refId)) {
      const nodeId = newId()
      const linksOf = opts.links.filter((l) => l.a.id === n.refId || l.b.id === n.refId)
      commands.push(
        addNode(n.refKind, n.refId, x, y, {
          id: nodeId,
          device: n.card,
          links: linksOf.map((l) => ({
            id: l.id,
            aId: l.a.id,
            bId: l.b.id,
            kind: l.kind,
            aPort: l.a.interfaceName,
            bPort: l.b.interfaceName,
          })),
        }),
      )
      nodeIds.push(nodeId)
    }
  }
  if (opts.clone) {
    const full = new Map(opts.links.map((l) => [l.id, l]))
    for (const card of c.links) {
      const a = cloneOf.get(card.aId)
      const b = cloneOf.get(card.bId)
      if (!a || !b) continue
      const l = full.get(card.id)
      // Same kind of cable; what identifies one physical cable or circuit (cable ID, circuit, carrier) is not copied.
      commands.push(
        createLink({
          a: { kind: 'device', id: a },
          b: { kind: 'device', id: b },
          kind: card.kind,
          medium: l?.medium ?? '',
          speed: l?.speed ?? '',
          fiberMode: l?.fiberMode ?? '',
          connector: l?.connector ?? '',
          service: l?.service ?? '',
          status: 'planned',
        }),
      )
    }
  }
  return {
    command: compound(opts.clone ? 'duplicate' : 'paste', commands),
    nodeIds,
    cloned: cloneOf.size,
    skippedGroups,
  }
}
