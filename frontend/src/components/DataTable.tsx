import {
  columnVisibilityFeature,
  flexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type ColumnVisibilityState as VisibilityState,
  type RowData,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface DataColumnMeta {
  /** Header text, also used in the column chooser. */
  label: string
  /** Fixed width in px (required for pinned columns). */
  width?: number
  /** Pinned to the left next to the checkbox (hostname). */
  pin?: boolean
  align?: 'right'
  /** Cannot be hidden from the column chooser. */
  alwaysVisible?: boolean
}

// Only the features the table uses (TanStack Table v9 tree-shaking); sorting/pagination are manual.
const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: {} as DataColumnMeta,
})

// Column value types differ per column, hence `any` for TValue.
export type DataColumn<T extends RowData> = ColumnDef<typeof dataTableFeatures, T, any>

type OnChange<S> = (updater: Updater<S>) => void

const SELECT_WIDTH = 36
const PAGE_SIZES = [25, 50, 100]

/** Column visibility per user + table, kept in localStorage (DESIGN.md §7a). */
function useColumnVisibility(storageKey: string, defaults: VisibilityState) {
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? { ...defaults, ...(JSON.parse(saved) as VisibilityState) } : defaults
    } catch {
      return defaults
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibility))
    } catch {
      // storage full or disabled: the choice just is not remembered
    }
  }, [storageKey, visibility])
  return [visibility, setVisibility] as const
}

export interface DataTableProps<T extends RowData> {
  /** Stable id for saved column settings, e.g. "devices". */
  tableId: string
  /** Current user id: column settings are saved per user. */
  userId: string
  columns: DataColumn<T>[]
  /** Columns hidden until the user enables them. */
  defaultHidden?: string[]
  data: T[] | undefined
  total: number
  isLoading?: boolean
  error?: Error | null
  getRowId: (row: T) => string
  /** Row name for checkbox / action accessible names. */
  rowLabel: (row: T) => string
  pagination: PaginationState
  onPaginationChange: OnChange<PaginationState>
  sorting: SortingState
  onSortingChange: OnChange<SortingState>
  selection?: RowSelectionState
  onSelectionChange?: OnChange<RowSelectionState>
  /** Rendered in the action bar while rows are selected. */
  bulkActions?: (selectedIds: string[]) => ReactNode
  empty?: ReactNode
  /** Filter bar shown in the table's top bar, left of the column chooser. */
  filters?: ReactNode
  /** Extra controls next to the column chooser (e.g. density toggle). */
  toolbar?: ReactNode
  /** Height of the scroll frame; header stays visible while rows scroll inside it. */
  maxHeight?: string
  caption: string
}

/**
 * Server-driven table (TanStack Table, manual pagination/sorting): sticky header, horizontal scroll
 * inside its own frame with the checkbox + hostname columns pinned, multi-select with a bulk-action
 * bar, column chooser saved per user, skeleton and empty states.
 */
export function DataTable<T extends RowData>({
  tableId,
  userId,
  columns,
  defaultHidden = [],
  data,
  total,
  isLoading,
  error,
  getRowId,
  rowLabel,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  selection,
  onSelectionChange,
  bulkActions,
  empty,
  filters,
  toolbar,
  maxHeight = 'calc(100vh - 300px)',
  caption,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  const selectable = !!onSelectionChange
  const [visibility, setVisibility] = useColumnVisibility(
    `ntb-columns:${userId}:${tableId}`,
    Object.fromEntries(defaultHidden.map((id) => [id, false])),
  )

  const selectColumn: DataColumn<T> = {
    id: '_select',
    meta: { label: '', width: SELECT_WIDTH, alwaysVisible: true },
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label={t('table.selectAll')}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={t('table.selectRow', { name: rowLabel(row.original) })}
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
      />
    ),
  }

  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize))
  const table = useTable({
    features: dataTableFeatures,
    data: data ?? [],
    columns: selectable ? [selectColumn, ...columns] : columns,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: false,
    rowCount: total,
    state: {
      pagination,
      sorting,
      rowSelection: selection ?? {},
      columnVisibility: visibility,
    },
    onPaginationChange,
    onSortingChange,
    onRowSelectionChange: onSelectionChange,
    onColumnVisibilityChange: setVisibility,
    enableRowSelection: selectable,
  })

  // Left offsets for pinned columns: checkbox at 0, then each pinned column in order.
  const pinnedLeft = new Map<string, number>()
  let left = 0
  for (const col of table.getVisibleLeafColumns()) {
    if (col.id === '_select' || col.columnDef.meta?.pin) {
      pinnedLeft.set(col.id, left)
      left += col.columnDef.meta?.width ?? 0
    }
  }
  const lastPinned = [...pinnedLeft.keys()].at(-1)

  const cellStyle = (id: string, width?: number): CSSProperties => ({
    width,
    minWidth: width,
    maxWidth: width,
    ...(pinnedLeft.has(id) ? { position: 'sticky', left: pinnedLeft.get(id) } : {}),
  })
  const pinClass = (id: string) =>
    pinnedLeft.has(id) &&
    cn('z-[1] bg-inherit', id === lastPinned && 'shadow-[inset_-1px_0_0_var(--border)]')

  const selectedIds = Object.keys(selection ?? {}).filter((id) => selection?.[id])
  const rows = table.getRowModel().rows
  const from = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const to = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize)
  const hideable = table.getAllLeafColumns().filter((c) => !c.columnDef.meta?.alwaysVisible)

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-2 border-b border-border p-2">
        <div className="min-w-0 flex-1">{filters}</div>
        {toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <Columns3 aria-hidden /> {t('table.columns')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('table.showColumns')}</DropdownMenuLabel>
              {hideable.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {col.columnDef.meta?.label ?? col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className="relative overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{ maxHeight }}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-table">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-[2] bg-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="bg-muted">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      style={cellStyle(header.column.id, meta?.width)}
                      className={cn(
                        'h-8 border-b border-border px-cell-x text-left text-label font-medium whitespace-nowrap text-muted-foreground',
                        meta?.align === 'right' && 'text-right',
                        pinClass(header.column.id),
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm hover:text-foreground',
                            sorted && 'text-foreground',
                          )}
                          title={sorted === 'asc' ? t('table.sortDesc') : t('table.sortAsc')}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp aria-hidden className="size-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown aria-hidden className="size-3.5" />
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: Math.min(pagination.pageSize, 10) }, (_, i) => (
                <tr key={`skeleton-${i}`} className="bg-card" aria-hidden>
                  {table.getVisibleLeafColumns().map((col) => (
                    <td
                      key={col.id}
                      style={cellStyle(col.id, col.columnDef.meta?.width)}
                      className={cn('h-row border-b border-border px-cell-x', pinClass(col.id))}
                    >
                      <Skeleton className="h-3.5 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading &&
              !error &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-selected={row.getIsSelected() || undefined}
                  className="group/row bg-card hover:bg-muted data-selected:bg-[color-mix(in_srgb,var(--brand)_6%,var(--surface))] data-selected:[&>td:first-child]:shadow-[inset_2px_0_0_var(--brand)]"
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta
                    return (
                      <td
                        key={cell.id}
                        style={cellStyle(cell.column.id, meta?.width)}
                        className={cn(
                          'h-row border-b border-border px-cell-x py-cell-y whitespace-nowrap',
                          meta?.align === 'right' && 'text-right',
                          pinClass(cell.column.id),
                        )}
                      >
                        <div className="truncate">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
        {/* Outside the table so it is centred in the visible frame, not across all columns. */}
        {!isLoading && error && (
          <p role="alert" className="sticky left-0 px-3 py-8 text-center text-destructive">
            {t('table.error')}: {error.message}
          </p>
        )}
        {!isLoading && !error && rows.length === 0 && <div className="sticky left-0">{empty}</div>}
      </div>

      {selectable && selectedIds.length > 0 && (
        <div
          role="region"
          aria-label={t('table.selected', { count: selectedIds.length })}
          className="flex items-center gap-2 border-t border-border bg-[color-mix(in_srgb,var(--brand)_6%,var(--surface))] px-3 py-1.5"
        >
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden />
          <span className="font-medium">{t('table.selected', { count: selectedIds.length })}</span>
          <div className="flex flex-wrap items-center gap-1">{bulkActions?.(selectedIds)}</div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onSelectionChange?.({})}
          >
            {t('table.clearSelection')}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-4 border-t border-border px-3 py-1.5 text-muted-foreground">
        <span data-numeric>
          {t('table.range', {
            from: from.toLocaleString('vi-VN'),
            to: to.toLocaleString('vi-VN'),
            total: total.toLocaleString('vi-VN'),
          })}
        </span>
        <label className="flex items-center gap-2">
          {t('table.pageSize')}
          <select
            value={pagination.pageSize}
            onChange={(e) => onPaginationChange({ pageIndex: 0, pageSize: Number(e.target.value) })}
            className="h-6 rounded-sm border border-input bg-card px-1 text-foreground"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <span data-numeric className="mr-2">
            {t('table.page', { page: pagination.pageIndex + 1, pages: pageCount })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('table.prev')}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('table.next')}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}
