import { CircleX, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Severity } from './types'

/** Error / warning / info marker: shape and colour both carry the level (not colour alone, DESIGN.md). */
export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const Icon = severity === 'error' ? CircleX : severity === 'warning' ? TriangleAlert : Info
  return (
    <Icon
      aria-hidden
      className={cn(
        'shrink-0',
        severity === 'error' && 'text-status-down',
        severity === 'warning' && 'text-status-warning',
        severity === 'info' && 'text-primary',
        className,
      )}
    />
  )
}
