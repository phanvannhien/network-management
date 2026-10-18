import { newId, type DocCommand } from './commands'
import { firstPageId, SINGLE_PAGE, type PageLayer } from './pages'
import type { DocState } from './types'

// Page commands (P2-08): undoable like every other change. Adding the second page turns the implicit single page into
// a real one and gives every item its page id.

function ensurePages(d: DocState, firstName: string, layer: PageLayer) {
  if (d.view.pages && d.view.pages.length > 0) return
  d.view.pages = [{ id: SINGLE_PAGE, name: firstName, layer }]
  for (const n of d.view.nodes) n.pageId ??= SINGLE_PAGE
  for (const e of d.view.edges) e.pageId ??= SINGLE_PAGE
  for (const a of d.view.annotations) a.pageId ??= SINGLE_PAGE
}

/** A new empty page at the end. `firstName` / `firstLayer` name the implicit first page when this is the second one. */
export function addPage(
  id: string,
  name: string,
  layer: PageLayer,
  firstName: string,
  firstLayer: PageLayer,
): DocCommand {
  return {
    label: 'addPage',
    apply(d) {
      ensurePages(d, firstName, firstLayer)
      d.view.pages!.push({ id, name, layer })
    },
  }
}

export function renamePage(id: string, name: string, firstLayer: PageLayer): DocCommand {
  return {
    label: 'renamePage',
    apply(d) {
      ensurePages(d, name, firstLayer)
      const p = d.view.pages!.find((x) => x.id === id)
      if (p && p.name !== name) p.name = name
    },
  }
}

export function setPageLayer(id: string, layer: PageLayer, firstName: string): DocCommand {
  return {
    label: 'setPageLayer',
    apply(d) {
      ensurePages(d, firstName, layer)
      const p = d.view.pages!.find((x) => x.id === id)
      if (p && p.layer !== layer) p.layer = layer
    },
  }
}

/** Move a page one place left (-1) or right (+1) in the tabs. */
export function movePage(id: string, delta: -1 | 1): DocCommand {
  return {
    label: 'movePage',
    apply(d) {
      const pages = d.view.pages
      if (!pages) return
      const i = pages.findIndex((p) => p.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= pages.length) return
      const [p] = pages.splice(i, 1)
      pages.splice(j, 0, p!)
    },
  }
}

/** Remove a page and what is drawn on it (the inventory keeps everything); the last page cannot go. */
export function removePage(id: string): DocCommand {
  return {
    label: 'removePage',
    apply(d) {
      if (!d.view.pages || d.view.pages.length < 2) return
      const first = firstPageId(d.view)
      const on = (x: { pageId?: string }) => (x.pageId || first) === id
      d.view.nodes = d.view.nodes.filter((n) => !on(n))
      d.view.edges = d.view.edges.filter((e) => !on(e))
      d.view.annotations = d.view.annotations.filter((a) => !on(a))
      d.view.pages = d.view.pages.filter((p) => p.id !== id)
    },
  }
}

/** A copy of a page: the same objects at the same places (new view ids), frames and notes copied too. */
export function duplicatePage(
  id: string,
  newPageId: string,
  name: string,
  firstName: string,
): DocCommand {
  return {
    label: 'duplicatePage',
    apply(d) {
      const src = d.view.pages?.find((p) => p.id === id)
      ensurePages(d, firstName, src?.layer ?? 'physical')
      const page = d.view.pages!.find((p) => p.id === id)
      if (!page) return
      const i = d.view.pages!.indexOf(page)
      d.view.pages!.splice(i + 1, 0, { id: newPageId, name, layer: page.layer })
      for (const n of d.view.nodes.filter((x) => x.pageId === id))
        d.view.nodes.push({ ...n, id: newId(), pageId: newPageId })
      for (const a of d.view.annotations.filter((x) => x.pageId === id))
        d.view.annotations.push({ ...a, id: newId(), pageId: newPageId })
      // Edges follow (syncEdges); routing is copied for the cables drawn on both pages.
      for (const e of d.view.edges.filter((x) => x.pageId === id))
        d.view.edges.push({ ...e, id: newId(), pageId: newPageId })
    },
  }
}

/**
 * Put view nodes (and annotations) on another page: `copy` leaves them where they are too (a device as a landmark on
 * several pages). An object already on the target page is not placed twice.
 */
export function sendToPage(
  nodeIds: string[],
  annotationIds: string[],
  pageId: string,
  copy: boolean,
): DocCommand {
  return {
    label: copy ? 'copyToPage' : 'moveToPage',
    apply(d) {
      if (!d.view.pages?.some((p) => p.id === pageId)) return
      const first = firstPageId(d.view)
      const there = new Set(
        d.view.nodes
          .filter((n) => (n.pageId || first) === pageId)
          .map((n) => `${n.refKind}|${n.refId}`),
      )
      const ids = new Set(nodeIds)
      const drop = new Set<string>()
      for (const n of d.view.nodes.filter((x) => ids.has(x.id) && (x.pageId || first) !== pageId)) {
        const key = `${n.refKind}|${n.refId}`
        if (there.has(key)) {
          if (!copy) drop.add(n.id)
          continue
        }
        there.add(key)
        if (copy) d.view.nodes.push({ ...n, id: newId(), pageId, locked: false })
        else n.pageId = pageId
      }
      if (drop.size > 0) d.view.nodes = d.view.nodes.filter((n) => !drop.has(n.id))
      const anns = new Set(annotationIds)
      for (const a of d.view.annotations.filter((x) => anns.has(x.id))) {
        if (copy) d.view.annotations.push({ ...a, id: newId(), pageId })
        else a.pageId = pageId
      }
    },
  }
}

/** Keep where the user put an off-page connector (P2-08); a drag sends many with one mergeKey. */
export function setStub(
  key: string,
  pageId: string,
  x: number,
  y: number,
  mergeKey?: string,
): DocCommand {
  return {
    label: 'moveConnector',
    mergeKey,
    apply(d) {
      const multi = Boolean(d.view.pages && d.view.pages.length > 1)
      const first = firstPageId(d.view)
      const stubs = (d.view.stubs ??= [])
      const s = stubs.find((x) => x.key === key && (x.pageId || first) === pageId)
      if (s) {
        if (s.x !== x || s.y !== y) {
          s.x = x
          s.y = y
        }
      } else stubs.push(multi ? { key, pageId, x, y } : { key, x, y })
    },
  }
}

/** Put several objects on one page at once (an L3 page generated from IPAM): one undo step, once per page each. */
export function placeOnPage(
  pageId: string,
  nodes: {
    refKind: 'device' | 'endpoint_group' | 'subnet'
    refId: string
    x: number
    y: number
    width?: number
  }[],
): DocCommand {
  return {
    label: 'placeOnPage',
    apply(d) {
      const first = firstPageId(d.view)
      const multi = Boolean(d.view.pages && d.view.pages.length > 1)
      const there = new Set(
        d.view.nodes
          .filter((n) => (n.pageId || first) === pageId)
          .map((n) => `${n.refKind}|${n.refId}`),
      )
      for (const n of nodes) {
        const key = `${n.refKind}|${n.refId}`
        if (there.has(key)) continue
        there.add(key)
        d.view.nodes.push({
          id: newId(),
          refKind: n.refKind,
          refId: n.refId,
          x: n.x,
          y: n.y,
          ...(n.width !== undefined && { width: n.width }),
          ...(multi && { pageId }),
        })
      }
    },
  }
}

/** Width of a node drawn as a bar (an L3 subnet); a resize sends many with one mergeKey. */
export function setNodeWidth(nodeId: string, width: number, mergeKey?: string): DocCommand {
  return {
    label: 'resizeNode',
    mergeKey,
    apply(d) {
      const n = d.view.nodes.find((x) => x.id === nodeId)
      if (n && n.width !== width) n.width = width
    },
  }
}
