import type { Device } from '../../types/ntb'

export const DEFAULT_LABEL_TEMPLATE = '{hostname}\n{mgmtIp}'

const PLACEHOLDERS = ['hostname', 'mgmtIp', 'vendor', 'model', 'role', 'site'] as const

/**
 * Renders a node label from the page's label template (SRS §4/§8),
 * e.g. "{hostname}\n{mgmtIp}". Unknown placeholders stay as-is.
 */
export function renderLabelTemplate(template: string | undefined, device: Device): string {
  const tpl = template && template.trim() !== '' ? template : DEFAULT_LABEL_TEMPLATE
  let out = tpl
  for (const key of PLACEHOLDERS) {
    const value = device[key]
    out = out.replaceAll(`{${key}}`, typeof value === 'string' ? value : '')
  }
  return out
}
