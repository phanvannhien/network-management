import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  CircleX,
  TriangleAlert,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type Status = 'up' | 'down' | 'warning' | 'unknown' | 'planned' | 'notMonitored'

const ICONS = {
  up: CircleCheck,
  down: CircleX,
  warning: TriangleAlert,
  unknown: CircleHelp,
  planned: CircleDashed,
  notMonitored: CircleMinus,
} as const

const COLOR_VAR: Record<Status, string> = {
  up: 'var(--status-up)',
  down: 'var(--status-down)',
  warning: 'var(--status-warning)',
  unknown: 'var(--status-unknown)',
  planned: 'var(--status-planned)',
  notMonitored: 'var(--text-muted)',
}

/**
 * Status = icon + text + colour, never colour alone (DESIGN.md §3.2). Planned is outlined with a
 * dashed border; not-monitored has no fill.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status
  /** Overrides the default text (e.g. "Down · từ 09:42"). */
  label?: string
  className?: string
}) {
  const { t } = useTranslation()
  const Icon = ICONS[status]
  const color = COLOR_VAR[status]
  const filled = status !== 'planned' && status !== 'notMonitored'
  const style: CSSProperties = {
    color,
    backgroundColor: filled
      ? // Opaque tint over the surface: contrast stays ≥ 4.7:1 on hovered/selected rows too.
        `color-mix(in srgb, ${color} var(--status-tint), var(--surface))`
      : 'transparent',
    borderColor: status === 'planned' ? color : 'transparent',
  }
  return (
    <span
      data-status={status}
      style={style}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap',
        status === 'planned' && 'border-dashed',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
      {label ?? t(`status.${status}`)}
    </span>
  )
}
