import type { NtbData } from '../model/types'
import type { Problem } from './rules'
import { MVP_RULES } from './rules'

/** Runs every MVP rule (SRS §6, Phase 1) and flattens the results. */
export function runValidation(data: NtbData): Problem[] {
  return MVP_RULES.flatMap((rule) => rule(data))
}
