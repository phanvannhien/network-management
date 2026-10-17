import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A folded side panel: a slim vertical tab at the canvas edge (same place as the panel), one click unfolds it.
 * The canvas keeps almost all of its width while the panel stays one click away.
 */
export function PanelRail({
  side,
  label,
  icon,
  badge,
  onExpand,
}: {
  side: 'left' | 'right'
  label: string
  icon: ReactNode
  /** e.g. the selected object's name on the property rail. */
  badge?: string
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onExpand}
      className={cn(
        'absolute top-16 z-10 flex w-9 flex-col items-center gap-2 rounded-lg border border-border bg-popover py-3 text-popover-foreground shadow-md hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span className="text-xs font-medium [writing-mode:vertical-rl]">{badge ?? label}</span>
    </button>
  )
}
