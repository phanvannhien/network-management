import { useQuery } from '@tanstack/react-query'
import { api, errorMessage, type components } from '@/api/client'
import i18n from '@/i18n'

// Multi-level diagrams (P2-21, ADR-040): an overview stores only where its site nodes sit; the site cards and the
// edges between sites come from the site graph, i.e. the inventory, each time the overview opens.

export type SiteGraph = components['schemas']['SiteGraph']
export type SiteCard = components['schemas']['SiteCard']
export type SiteEdge = components['schemas']['SiteEdge']
type View = components['schemas']['DiagramView']

export const siteGraphKey = (orgId: string, categoryId: string | null = null) =>
  ['orgs', orgId, 'site-graph', categoryId] as const

export function useSiteGraph(orgId: string, enabled = true, categoryId: string | null = null) {
  return useQuery({
    queryKey: siteGraphKey(orgId, categoryId),
    enabled: enabled && orgId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const r = await api.GET('/orgs/{orgId}/site-graph', {
        params: { path: { orgId }, query: categoryId ? { categoryId } : {} },
      })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, i18n.t('overview.loadFailed')))
    },
  })
}

const HUB_NAME = /(^|[^a-z])(hq|ho|tsc|idc|dc)([^a-z]|$)|trụ sở|tru so|head ?office/i

/**
 * The likely hub(s): the site with the most links to other sites, a datacenter, a name saying head office — in that
 * order. Two hubs when a head office and a datacenter both peer widely (HO in Hà Nội, servers at an IDC).
 */
export function suggestHubs(sites: SiteCard[]): string[] {
  if (sites.length < 2) return []
  const score = (s: SiteCard) =>
    s.peers * 10 +
    (s.kind === 'datacenter' ? 5 : 0) +
    (HUB_NAME.test(`${s.localCode} ${s.name}`) ? 3 : 0)
  const ranked = [...sites].sort((a, b) => score(b) - score(a) || a.code.localeCompare(b.code))
  const top = ranked[0]!
  if (score(top) === 0) return []
  const second = ranked[1]
  return second && second.peers >= 2 && second.peers >= top.peers / 2
    ? [top.id, second.id]
    : [top.id]
}

export const SITE_W = 184
export const SITE_H = 112
const GAP_X = 56
const GAP_Y = 72
const PAD = 32
const TITLE = 36
const COLS = 4

/**
 * A first overview (P2-21): the hub(s) centred on top, the other sites below in one frame per category (a grid inside
 * each frame — a giant circle gets unreadable past a dozen sites). Edges are not stored: they are derived.
 */
export function overviewView(
  graph: SiteGraph,
  hubs: string[],
  byCategory: boolean,
  newId: () => string = () => crypto.randomUUID(),
  noCategory = 'Trực thuộc tổ chức',
): View {
  const nodes: View['nodes'] = []
  const annotations: View['annotations'] = []
  const hubSet = new Set(hubs)
  const spokes = graph.sites.filter((s) => !hubSet.has(s.id))
  const groups = new Map<string, SiteCard[]>()
  for (const s of spokes) {
    const k = byCategory ? s.categoryPath || noCategory : ''
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  // Frames side by side; total width decides where the hubs sit.
  const frames = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  const widthOf = (n: number) => {
    const cols = Math.min(COLS, Math.max(1, n))
    return PAD * 2 + cols * SITE_W + (cols - 1) * GAP_X
  }
  const total = frames.reduce((w, [, s]) => w + widthOf(s.length) + GAP_X, -GAP_X)
  const hubRowW = hubs.length * SITE_W + (hubs.length - 1) * GAP_X
  const hubX = Math.max(0, (total - hubRowW) / 2)
  hubs.forEach((id, i) =>
    nodes.push({ id: newId(), refKind: 'site', refId: id, x: hubX + i * (SITE_W + GAP_X), y: 0 }),
  )
  const top = hubs.length > 0 ? SITE_H + GAP_Y * 2 : 0
  let x = 0
  for (const [title, sites] of frames) {
    const cols = Math.min(COLS, Math.max(1, sites.length))
    const rows = Math.ceil(sites.length / cols)
    const w = widthOf(sites.length)
    const h = TITLE + PAD + rows * SITE_H + (rows - 1) * GAP_Y + PAD
    if (byCategory)
      annotations.push({ id: newId(), kind: 'zone', x, y: top, width: w, height: h, text: title })
    const sorted = [...sites].sort((a, b) => a.code.localeCompare(b.code))
    sorted.forEach((s, i) =>
      nodes.push({
        id: newId(),
        refKind: 'site',
        refId: s.id,
        x: x + PAD + (i % cols) * (SITE_W + GAP_X),
        y: top + (byCategory ? TITLE : 0) + PAD + Math.floor(i / cols) * (SITE_H + GAP_Y),
      }),
    )
    x += w + GAP_X
  }
  return { nodes, edges: [], annotations, viewport: { x: 0, y: 0, zoom: 1 } }
}

/** Positions for sites missing from an overview: a row under everything already drawn (positions kept). */
export function placeMissing(
  view: { nodes: { x: number; y: number }[] },
  ids: string[],
): { id: string; x: number; y: number }[] {
  const bottom = view.nodes.reduce((m, n) => Math.max(m, n.y + SITE_H), 0)
  const left = view.nodes.reduce((m, n) => Math.min(m, n.x), Number.POSITIVE_INFINITY)
  const x0 = Number.isFinite(left) ? left : 0
  return ids.map((id, i) => ({
    id,
    x: x0 + (i % 6) * (SITE_W + GAP_X),
    y: bottom + GAP_Y + Math.floor(i / 6) * (SITE_H + GAP_Y),
  }))
}
