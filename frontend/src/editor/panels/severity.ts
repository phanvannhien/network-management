import { CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Severity } from '../validation/rules'

/** Severity = icon + text + colour (DESIGN.md §3.2), never a coloured dot alone. */
export const SEVERITY: Record<Severity, { icon: LucideIcon; color: string }> = {
  error: { icon: CircleX, color: 'var(--status-down)' },
  warning: { icon: TriangleAlert, color: 'var(--status-warning)' },
  info: { icon: Info, color: 'var(--brand)' },
}
