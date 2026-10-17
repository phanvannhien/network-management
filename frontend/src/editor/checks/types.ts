import type { components } from '@/api/client'

// Diagram checks (P1-20, SRS §7): results of the rules, computed in a Web Worker from the document and the validation
// context the server returns. Messages are i18n keys + params (the worker has no translations).

export type ValidationContext = components['schemas']['ValidationContext']

export type Severity = 'error' | 'warning' | 'info'

export interface Problem {
  /** Stable: rule + object, for list keys and dedupe. */
  key: string
  rule: string
  severity: Severity
  /** i18n key under `checks.rules`, and its params. */
  params: Record<string, string | number>
  /** What clicking the problem shows: a view node or an edge (cable). */
  target: { kind: 'node' | 'edge'; id: string }
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** Problem counts per level, for the toolbar button. */
export function countProblems(problems: Problem[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const p of problems) out[p.severity]++
  return out
}
