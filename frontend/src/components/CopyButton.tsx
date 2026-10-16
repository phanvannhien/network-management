import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

/** Small icon button that copies a value and confirms with a check mark for 1.5 s. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  /** What is copied, for the accessible name ("Copy IP quản trị"). */
  label: string
  className?: string
}) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(id)
  }, [done])

  return (
    <button
      type="button"
      aria-label={t('common.copyValue', { label })}
      title={t('common.copyValue', { label })}
      onClick={(e) => {
        e.stopPropagation()
        void copyText(value).then(setDone)
      }}
      className={cn(
        'inline-grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {done ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      <span className="sr-only" aria-live="polite">
        {done ? t('common.copied') : ''}
      </span>
    </button>
  )
}
