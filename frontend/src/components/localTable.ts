import type { PaginationState, SortingState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

/**
 * Client-side paging/sorting for short lists (members, organizations, users) so they can use the
 * same DataTable as server-paginated lists.
 */
export function useLocalTable<T>(
  rows: T[] | undefined,
  sortKeys: Record<string, (row: T) => string | number>,
  initialSort: SortingState = [],
) {
  const [sorting, setSorting] = useState<SortingState>(initialSort)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])]
    const s = sorting[0]
    const key = s && sortKeys[s.id]
    if (key) {
      list.sort((a, b) => {
        const x = key(a)
        const y = key(b)
        const c =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'vi')
        return s.desc ? -c : c
      })
    }
    return list
    // sortKeys is a literal per page; re-sorting only follows data and sort state.
  }, [rows, sorting])
  const start = pagination.pageIndex * pagination.pageSize
  return {
    data: rows ? sorted.slice(start, start + pagination.pageSize) : undefined,
    total: sorted.length,
    sorting,
    onSortingChange: setSorting,
    pagination,
    onPaginationChange: setPagination,
    resetPage: () => setPagination((p) => ({ ...p, pageIndex: 0 })),
  }
}
