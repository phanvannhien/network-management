import { create } from 'zustand'
import { useCatalog, type CatalogModel } from './devices'
import { matchCatalog } from './import/plan'

// Product photos (P2-12, ADR-041): front / rear pictures of catalog models, from the NetBox device type library (CC0).
// They load only when someone opens them, so a large diagram costs nothing extra.

export function catalogImageUrl(orgId: string, file: string): string {
  return `/api/orgs/${orgId}/device-catalog/images/${encodeURIComponent(file)}`
}

export interface PhotoSubject {
  catalogId?: string
  model?: string
  partNumber?: string
  type?: string
}

/** Lookups by device facts, built once per catalog list (a 500 device diagram asks once per node). */
const lookups = new WeakMap<CatalogModel[], Map<string, CatalogModel | null>>()

export function photoModel(models: CatalogModel[], d: PhotoSubject): CatalogModel | null {
  let cache = lookups.get(models)
  if (!cache) {
    cache = new Map()
    lookups.set(models, cache)
  }
  const key = [d.catalogId, d.model, d.partNumber, d.type].join('\u0000')
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  // The model the device was made from, else the one its model / part number names.
  const m =
    (d.catalogId ? models.find((x) => x.id === d.catalogId) : undefined) ??
    matchCatalog(models, [d.model ?? '', d.partNumber ?? ''], d.type)
  const found = m && (m.images.front || m.images.rear) ? m : null
  cache.set(key, found)
  return found
}

/** The catalog model with photos for this device, or null. */
export function usePhotoModel(orgId: string, d: PhotoSubject | undefined): CatalogModel | null {
  const catalog = useCatalog(orgId, Boolean(d))
  if (!d || !catalog.data) return null
  return photoModel(catalog.data, d)
}

/**
 * The photo being shown. One viewer for the whole page (mounted by the organization shell): a dialog rendered inside
 * a diagram node would hand its clicks and keys to the node (select, drag, drill down) and vanish with the hover.
 */
export const usePhotoViewer = create<{
  shown: { model: CatalogModel; title?: string } | null
  show: (model: CatalogModel, title?: string) => void
  close: () => void
}>((set) => ({
  shown: null,
  show: (model, title) => set({ shown: { model, title } }),
  close: () => set({ shown: null }),
}))
