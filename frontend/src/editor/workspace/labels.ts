import type { CSSProperties } from 'react'
import type { DeviceCard } from '../doc/types'

// Device labels on the canvas (SRS §6.3): a template per diagram ("{hostname}\n{mgmtIp}" by default) and an optional
// background colour per node. The first line is the name (bold); the others are details (hidden below 50 % zoom).

export const DEFAULT_LABEL = '{hostname}\n{mgmtIp}'

export const LABEL_PRESETS = [
  { id: 'ip', template: DEFAULT_LABEL },
  { id: 'model', template: '{hostname}\n{model}' },
  { id: 'site', template: '{hostname}\n{site}' },
  { id: 'ipModel', template: '{hostname}\n{mgmtIp}\n{model}' },
  { id: 'type', template: '{hostname}\n{type}' },
  { id: 'name', template: '{hostname}' },
] as const

export type LabelPresetId = (typeof LABEL_PRESETS)[number]['id']

export function presetOf(template: string | undefined): LabelPresetId {
  return LABEL_PRESETS.find((p) => p.template === (template || DEFAULT_LABEL))?.id ?? 'ip'
}

export interface LabelLine {
  text: string
  /** An address: monospace. */
  mono: boolean
}

/** Lines of a device label; empty fields drop their line. The IP is shown without its prefix length. */
export function renderLabel(
  card: Pick<DeviceCard, 'hostname' | 'mgmtIp' | 'model' | 'siteCode'>,
  typeName: string,
  template: string | undefined,
): LabelLine[] {
  const values: Record<string, string> = {
    hostname: card.hostname,
    mgmtIp: card.mgmtIp?.split('/')[0] ?? '',
    model: card.model ?? '',
    site: card.siteCode ?? '',
    type: typeName,
  }
  return (template || DEFAULT_LABEL)
    .split('\n')
    .map((line) => ({
      text: line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '').trim(),
      mono: line.includes('{mgmtIp}'),
    }))
    .filter((l) => l.text !== '')
}

/** Label background palette: names, mapped to theme-aware tints in index.css (.ntb-tag-*). */
export const LABEL_COLORS = ['blue', 'green', 'amber', 'red', 'violet', 'slate'] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

/** A colour picked freely (`#rrggbb`) rather than a palette name — the only free form drawn inline. */
export const isHexColor = (c: string | undefined): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c)

/** Label background for a palette name (class) or a free colour (inline, same 18 % mix as the palette). */
export function tagColor(c: string | undefined): { className?: string; style?: CSSProperties } {
  if (!c) return {}
  if (isHexColor(c))
    return { style: { background: `color-mix(in srgb, ${c} 18%, var(--surface))` } }
  return { className: `ntb-tag-${c}` }
}
