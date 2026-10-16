import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * Compact one-line figure (DESIGN.md §7c): label + number, optional status icon and link to the
 * pre-filtered list. Not a big decorative card.
 */
export function StatCard({
  label,
  value,
  icon,
  to,
  tone,
  className,
}: {
  label: string
  value: number | string
  icon?: ReactNode
  to?: string
  tone?: 'down' | 'warning' | 'up'
  className?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-label text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        data-numeric
        className="text-lg leading-7 font-semibold"
        style={tone ? { color: `var(--status-${tone})` } : undefined}
      >
        {typeof value === 'number' ? value.toLocaleString('vi-VN') : value}
      </span>
    </>
  )
  const cls = cn(
    'flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2',
    to && 'hover:border-border-control focus-visible:border-ring',
    className,
  )
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
