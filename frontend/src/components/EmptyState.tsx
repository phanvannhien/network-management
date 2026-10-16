import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Empty list / no results / nothing yet: icon, one-line title, hint and an optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  titleAs: Title = 'p',
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** Use 'h1' when the empty state is the whole page (404). */
  titleAs?: 'p' | 'h1' | 'h2'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <Title className="text-sm font-semibold">{title}</Title>
      {description && <p className="max-w-md text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
