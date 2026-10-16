import { ChevronDown, ChevronUp, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../model/store'
import type { Problem, Severity } from '../validation/rules'

/** Severity = icon + text + colour (DESIGN.md §3.2), never a coloured dot alone. */
export const SEVERITY: Record<Severity, { icon: LucideIcon; color: string }> = {
  error: { icon: CircleX, color: 'var(--status-down)' },
  warning: { icon: TriangleAlert, color: 'var(--status-warning)' },
  info: { icon: Info, color: 'var(--brand)' },
}

/** Bottom panel listing validation problems; click focuses the object on the canvas. */
export function Problems() {
  const { t } = useTranslation()
  const problems = useAppStore((s) => s.problems)
  const setFocusTarget = useAppStore((s) => s.setFocusTarget)
  const [open, setOpen] = useState(true)

  const counts = {
    error: problems.filter((p) => p.severity === 'error').length,
    warning: problems.filter((p) => p.severity === 'warning').length,
    info: problems.filter((p) => p.severity === 'info').length,
  }

  return (
    <section aria-label={t('editor.problems')} className="shrink-0 border-t border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-3 px-3 font-medium hover:bg-muted"
      >
        {t('editor.problems')}
        <span className="flex items-center gap-3 font-normal">
          {(['error', 'warning', 'info'] as const).map((severity) => {
            const { icon: Icon, color } = SEVERITY[severity]
            return (
              <span key={severity} className="flex items-center gap-1" data-numeric>
                <Icon aria-hidden className="size-3.5" style={{ color }} />
                <span className="sr-only">{t(`editor.severity.${severity}`)}</span>
                {counts[severity]}
              </span>
            )
          })}
        </span>
        {open ? (
          <ChevronDown aria-hidden className="ml-auto size-4 text-muted-foreground" />
        ) : (
          <ChevronUp aria-hidden className="ml-auto size-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <ul className="max-h-40 overflow-y-auto border-t border-border">
          {problems.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">{t('editor.noProblems')}</li>
          )}
          {problems.map((problem: Problem) => {
            const { icon: Icon, color } = SEVERITY[problem.severity]
            return (
              <li key={problem.key}>
                <button
                  type="button"
                  onClick={() => setFocusTarget({ ...problem.target, nonce: Date.now() })}
                  className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-muted"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" style={{ color }} />
                  <span className="w-20 shrink-0" style={{ color }}>
                    {t(`editor.severity.${problem.severity}`)}
                  </span>
                  <span className="truncate">{problem.message}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
