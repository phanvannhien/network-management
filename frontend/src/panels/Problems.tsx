import { useState } from 'react'
import { useAppStore } from '../model/store'
import type { Problem, Severity } from '../validation/rules'

const SEVERITY_STYLE: Record<Severity, { dot: string; label: string }> = {
  error: { dot: 'bg-red-500', label: 'Error' },
  warning: { dot: 'bg-amber-500', label: 'Warning' },
  info: { dot: 'bg-blue-500', label: 'Info' },
}

/** Bottom panel listing validation problems; click focuses the object on the canvas. */
export function Problems() {
  const problems = useAppStore((s) => s.problems)
  const setFocusTarget = useAppStore((s) => s.setFocusTarget)
  const [open, setOpen] = useState(true)

  const counts = {
    error: problems.filter((p) => p.severity === 'error').length,
    warning: problems.filter((p) => p.severity === 'warning').length,
    info: problems.filter((p) => p.severity === 'info').length,
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background/95">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Problems
        <span className="flex items-center gap-2 text-muted-foreground">
          {(['error', 'warning', 'info'] as const).map((severity) => (
            <span key={severity} className="flex items-center gap-1">
              <span
                className={`inline-block size-2 rounded-full ${SEVERITY_STYLE[severity].dot}`}
              />
              {counts[severity]}
            </span>
          ))}
        </span>
        <span className="ml-auto text-muted-foreground">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <ul className="max-h-40 overflow-y-auto text-xs">
          {problems.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">Không có vấn đề nào 🎉</li>
          )}
          {problems.map((problem: Problem) => (
            <li key={problem.key}>
              <button
                type="button"
                onClick={() => setFocusTarget({ ...problem.target, nonce: Date.now() })}
                className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent"
              >
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${SEVERITY_STYLE[problem.severity].dot}`}
                />
                <span className="text-muted-foreground">
                  {SEVERITY_STYLE[problem.severity].label}
                </span>
                <span className="truncate">{problem.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
