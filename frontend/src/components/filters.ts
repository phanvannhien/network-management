export interface FilterState {
  q: string
  facets: Record<string, string[]>
}

export const emptyFilter: FilterState = { q: '', facets: {} }

export function isFilterActive(f: FilterState): boolean {
  return f.q !== '' || Object.values(f.facets).some((v) => v.length > 0)
}
