import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface KeyValueItem {
  label: string
  value: ReactNode
}

/** Label/value pairs in a strip of 2–4 columns (device detail header, settings summaries). */
export function KeyValueList({
  items,
  columns = 4,
  wrap = false,
  className,
}: {
  items: KeyValueItem[]
  columns?: 1 | 2 | 3 | 4
  /** Let long values wrap instead of truncating. */
  wrap?: boolean
  className?: string
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-2',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-3',
        columns === 4 && 'grid-cols-4',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-2"
        >
          <dt className="text-label text-muted-foreground">{item.label}</dt>
          <dd className={cn('min-w-0', wrap ? 'break-words' : 'truncate')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
