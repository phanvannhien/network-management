import { useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDoc, useDocStoreApi } from '../workspace/context'
import { SeverityIcon } from './SeverityIcon'
import { countProblems, SEVERITY_ORDER, type Problem, type Severity } from './types'
import { pageOf } from '../doc/pages'

const LEVELS: Severity[] = ['error', 'warning', 'info']

/**
 * Problems panel (P1-20, SRS §7): every check result, worst first; a click selects the object and zooms to it. Each
 * line says what is wrong and, below, how it is usually fixed (DESIGN.md §4a: plain words for non-specialists).
 */
export function ProblemsPanel({
  loading,
  error,
  fitPadding,
  onClose,
}: {
  loading: boolean
  error: Error | null
  fitPadding: Parameters<ReturnType<typeof useReactFlow>['fitView']>[0]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const flow = useReactFlow()
  const problems = useDoc((s) => s.problems)
  const [hidden, setHidden] = useState<Set<Severity>>(new Set())
  const counts = useMemo(() => countProblems(problems), [problems])
  const shown = useMemo(
    () =>
      problems
        .filter((p) => !hidden.has(p.severity))
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [problems, hidden],
  )

  /** Coded params (why / which) in words. */
  const words = (p: Problem): Record<string, string | number> => ({
    ...p.params,
    ...(p.params.why ? { why: t(`checks.why.${p.params.why}` as 'checks.why.format') } : {}),
    ...(p.params.which
      ? { which: t(`checks.which.${p.params.which}` as 'checks.which.network') }
      : {}),
    ...(p.params.fields
      ? {
          fields: String(p.params.fields)
            .split(',')
            .map((f) => t(`checks.fields.${f}` as 'checks.fields.serial'))
            .join(', '),
        }
      : {}),
  })

  const focus = (p: Problem) => {
    const s = store.getState()
    // Checks cover every page (P2-08): a problem on another page opens that page first (its canvas mounts anew).
    const view = s.doc?.view
    const item =
      p.target.kind === 'node'
        ? view?.nodes.find((n) => n.id === p.target.id)
        : view?.edges.find((e) => e.id === p.target.id)
    const page = view && item ? pageOf(view, item) : s.page
    const switching = page !== s.page
    if (switching) s.setPage(page)
    const later = (f: () => void) => (switching ? window.setTimeout(f, 250) : f())
    if (p.target.kind === 'node') {
      const id = p.target.id
      s.setEdgeSelection([])
      s.setSelection([id])
      later(
        () => void flow.fitView({ ...fitPadding, nodes: [{ id }], maxZoom: 1.2, duration: 150 }),
      )
      return
    }
    const id = p.target.id
    s.setSelection([])
    s.setEdgeSelection([id])
    later(() => {
      const edge = flow.getEdge(id)
      if (edge)
        void flow.fitView({
          ...fitPadding,
          nodes: [{ id: edge.source }, { id: edge.target }],
          maxZoom: 1.2,
          duration: 150,
        })
    })
  }

  return (
    <section
      aria-label={t('checks.title')}
      className="absolute bottom-3 left-1/2 z-10 flex max-h-72 w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="font-semibold">{t('checks.title')}</h2>
        <div className="flex flex-1 gap-1" role="group" aria-label={t('checks.filter')}>
          {LEVELS.map((level) => (
            <Button
              key={level}
              variant={hidden.has(level) ? 'ghost' : 'secondary'}
              size="sm"
              className="h-7 gap-1 px-2"
              aria-pressed={!hidden.has(level)}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h)
                  if (next.has(level)) next.delete(level)
                  else next.add(level)
                  return next
                })
              }
            >
              <SeverityIcon severity={level} className="size-3.5" />
              {t(`checks.severity.${level}`)} {counts[level]}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <p className="border-b border-border px-3 py-1 text-xs text-muted-foreground">
        {t('checks.guide')}
      </p>
      {error && <p className="px-3 py-2 text-sm text-status-down">{error.message}</p>}
      {loading && problems.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t('checks.loading')}</p>
      )}
      {!loading && !error && shown.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {problems.length === 0 ? t('checks.none') : t('checks.allHidden')}
        </p>
      )}
      <ul className="overflow-y-auto">
        {shown.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
              )}
              onClick={() => focus(p)}
            >
              <SeverityIcon severity={p.severity} className="mt-0.5 size-4" />
              <span className="sr-only">{t(`checks.severity.${p.severity}`)}:</span>
              <span className="min-w-0 flex-1">
                <span className="block">
                  {t(`checks.rules.${p.rule as 'no-cable'}`, words(p) as { host: string })}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`checks.fix.${p.rule as 'no-cable'}`)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
