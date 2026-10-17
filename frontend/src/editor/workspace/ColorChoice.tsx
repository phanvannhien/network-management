import { X } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { isHexColor, LABEL_COLORS, tagColor } from './labels'

/**
 * The colour of a node label / frame / text / arrow: none, the palette, or any colour from the system picker
 * (`#rrggbb`). Dragging in the picker sends many values; `onPick` gets the same merge key for one gesture so the
 * whole drag is one undo step.
 */
export function ColorChoice({
  label,
  current,
  onPick,
}: {
  label: string
  current: string
  onPick: (color: string, mergeKey?: string) => void
}) {
  const { t } = useTranslation()
  const gesture = useRef<string | null>(null)
  const custom = isHexColor(current)
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {(['', ...LABEL_COLORS] as const).map((c) => (
        <button
          key={c || 'none'}
          type="button"
          role="radio"
          aria-checked={current === c}
          aria-label={t(`panel.colors.${c || 'none'}`)}
          title={t(`panel.colors.${c || 'none'}`)}
          onClick={() => onPick(c)}
          className={cn(
            'size-6 rounded-sm border border-border-control',
            c ? `ntb-tag-${c}` : 'bg-card',
            current === c && 'ring-2 ring-primary',
          )}
        >
          {!c && <X aria-hidden className="m-auto size-3 text-muted-foreground" />}
        </button>
      ))}
      <label
        title={t('panel.colors.custom')}
        className={cn(
          'relative flex h-6 cursor-pointer items-center gap-1 rounded-sm border border-border-control px-1 text-xs',
          custom && 'ring-2 ring-primary',
        )}
        style={custom ? tagColor(current).style : undefined}
      >
        <span
          aria-hidden
          className="size-4 rounded-sm border border-border"
          style={{
            background: custom
              ? current
              : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ef4444)',
          }}
        />
        <span>{custom ? current : t('panel.colors.custom')}</span>
        <input
          type="color"
          aria-label={t('panel.colors.custom')}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={custom ? current : '#2563eb'}
          onFocus={() => (gesture.current = `color:${crypto.randomUUID()}`)}
          onChange={(e) => onPick(e.target.value, gesture.current ?? undefined)}
          onBlur={() => (gesture.current = null)}
        />
      </label>
    </div>
  )
}
