import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Page title (the only H1), optional count/meta, description and right-aligned actions. */
export function PageHeader({
  title,
  count,
  meta,
  description,
  actions,
  className,
}: {
  title: ReactNode
  count?: number
  meta?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-title font-semibold">{title}</h1>
          {count !== undefined && (
            <span data-numeric className="text-muted-foreground">
              {count.toLocaleString('vi-VN')}
            </span>
          )}
          {meta}
        </div>
        {description && <div className="text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
