import type { components } from '@/api/client'
import type { DocState } from './types'

// Pages of one diagram (P2-08, ADR-047): tabs over one document — one save, one undo history. Nodes, edges and
// annotations name their page; a diagram without pages is one page, and an item without a page id is on the first
// page. Once a second page exists every item carries its page id, so pages can be reordered and removed freely.

export type DiagramPage = components['schemas']['DiagramPage']
export type PageLayer = DiagramPage['layer']

/** Id of the one page of a diagram that has no page list. */
export const SINGLE_PAGE = 'p1'

interface Paged {
  pageId?: string
}

export function firstPageId(view: DocState['view']): string {
  return view.pages?.[0]?.id ?? SINGLE_PAGE
}

/** The pages in tab order; a diagram without a list has one (unnamed: the tab says "Page 1"). */
export function pagesOf(view: DocState['view'], layer: string): DiagramPage[] {
  if (view.pages && view.pages.length > 0) return view.pages
  return [{ id: SINGLE_PAGE, name: '', layer: layer === 'l2' ? 'l2' : 'physical' }]
}

export function pageOf(view: DocState['view'], item: Paged): string {
  return item.pageId || firstPageId(view)
}

/** A page id that exists (else the first page). */
export function validPage(view: DocState['view'], pageId: string | null | undefined): string {
  return pageId && view.pages?.some((p) => p.id === pageId) ? pageId : firstPageId(view)
}

// Filtered lists per (list, page), so an unchanged list keeps giving the same array.
const filtered = new WeakMap<object, Map<string, unknown[]>>()

function onPage<T extends Paged>(list: T[], pageId: string, first: string): T[] {
  let byPage = filtered.get(list)
  if (!byPage) {
    byPage = new Map()
    filtered.set(list, byPage)
  }
  let out = byPage.get(`${first}|${pageId}`) as T[] | undefined
  if (!out) {
    out = list.filter((x) => (x.pageId || first) === pageId)
    byPage.set(`${first}|${pageId}`, out)
  }
  return out
}

const pageDocs = new WeakMap<DocState, Map<string, DocState>>()

/**
 * The document as seen on one page: the same inventory, the view reduced to the page's nodes, edges and annotations.
 * What the canvas draws and what geometry (frames, clusters) works on. Cached per document and page.
 */
export function docOnPage(doc: DocState, pageId: string): DocState {
  const first = firstPageId(doc.view)
  if (!doc.view.pages || doc.view.pages.length < 2) {
    if (pageId === first) return doc
  }
  let byPage = pageDocs.get(doc)
  if (!byPage) {
    byPage = new Map()
    pageDocs.set(doc, byPage)
  }
  let out = byPage.get(pageId)
  if (!out) {
    out = {
      ...doc,
      view: {
        ...doc.view,
        nodes: onPage(doc.view.nodes, pageId, first),
        edges: onPage(doc.view.edges, pageId, first),
        annotations: onPage(doc.view.annotations, pageId, first),
      },
    }
    byPage.set(pageId, out)
  }
  return out
}

const refPages = new WeakMap<object, Map<string, string[]>>()

/** Pages each object is placed on, in tab order (badge "also on page …"). */
export function pagesOfRefs(view: DocState['view']): Map<string, string[]> {
  let out = refPages.get(view.nodes)
  if (!out) {
    out = new Map()
    const first = firstPageId(view)
    const order = new Map((view.pages ?? []).map((p, i) => [p.id, i]))
    for (const n of view.nodes) {
      const list = out.get(n.refId) ?? []
      const p = n.pageId || first
      if (!list.includes(p)) list.push(p)
      out.set(n.refId, list)
    }
    for (const list of out.values()) list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    refPages.set(view.nodes, out)
  }
  return out
}

/**
 * Keeps edges in step with the pages (after every command): one edge per link and page where both ends of the link
 * are on that page; edges of links whose ends are no longer together on their page go. Edges of links we cannot see
 * (hidden) stay as they are.
 */
export function syncEdges(d: DocState, newEdgeId: () => string): void {
  const first = firstPageId(d.view)
  const refs = new Map<string, Set<string>>()
  for (const n of d.view.nodes) {
    const p = n.pageId || first
    const set = refs.get(p) ?? new Set<string>()
    set.add(n.refId)
    refs.set(p, set)
  }
  const together = (p: string, a: string, b: string) => {
    const set = refs.get(p)
    return Boolean(set && set.has(a) && set.has(b))
  }
  const seen = new Set<string>()
  const keep = d.view.edges.filter((e) => {
    const l = d.links[e.linkId]
    if (!l) return d.hidden.includes(e.linkId)
    const p = e.pageId || first
    const key = `${p}|${e.linkId}`
    if (seen.has(key) || !together(p, l.aId, l.bId)) return false
    seen.add(key)
    return true
  })
  if (keep.length !== d.view.edges.length) d.view.edges = keep
  const multi = Boolean(d.view.pages && d.view.pages.length > 1)
  for (const [p, set] of refs)
    for (const l of Object.values(d.links)) {
      if (seen.has(`${p}|${l.id}`) || !set.has(l.aId) || !set.has(l.bId)) continue
      seen.add(`${p}|${l.id}`)
      d.view.edges.push(
        multi ? { id: newEdgeId(), linkId: l.id, pageId: p } : { id: newEdgeId(), linkId: l.id },
      )
    }
}

/** Items a command added without a page land on the page being edited (once the diagram has several pages). */
export function assignPage(d: DocState, before: DocState, pageId: string): void {
  if (!d.view.pages || d.view.pages.length < 2) return
  const had = (list: { id: string }[]) => new Set(list.map((x) => x.id))
  const nodes = had(before.view.nodes)
  const edges = had(before.view.edges)
  const anns = had(before.view.annotations)
  for (const n of d.view.nodes) if (!n.pageId && !nodes.has(n.id)) n.pageId = pageId
  for (const e of d.view.edges) if (!e.pageId && !edges.has(e.id)) e.pageId = pageId
  for (const a of d.view.annotations) if (!a.pageId && !anns.has(a.id)) a.pageId = pageId
}

/** Store state as seen on the page being edited: the same state, the document reduced to that page. */
export function onPageState<S extends { doc: DocState | null; page: string }>(s: S): S {
  return s.doc ? { ...s, doc: docOnPage(s.doc, s.page) } : s
}

/** Name shown on a tab: its own, or "Page n" for the unnamed single page. */
export function pageLabel(
  p: DiagramPage,
  index: number,
  t: (key: 'pages.untitled', options: { n: number }) => string,
): string {
  return p.name || t('pages.untitled', { n: index + 1 })
}
