import type { DocState } from '../doc/types'

/**
 * Site offered for a new device (P1-15 review): the one site every device on the diagram shares, else the site
 * used last in this editor, else none — the user picks; never silently the first site of the list. A site/location
 * frame under the drop point will come first once frames exist (P1-19).
 */
export function defaultSiteFor(doc: DocState, lastUsed: string | null): string | null {
  const sites = new Set<string>()
  for (const n of doc.view.nodes) {
    const d = n.refKind === 'device' ? doc.devices[n.refId] : undefined
    if (d) sites.add(d.siteId)
  }
  if (sites.size === 1) return [...sites][0]!
  return lastUsed
}
