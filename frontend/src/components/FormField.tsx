import { useId, type ReactNode } from 'react'
import { FieldHelp } from '@/components/FieldHelp'
import { usePreferences } from '@/lib/preferences'
import { cn } from '@/lib/utils'

/** Props a control needs to be wired to its label, hint and error. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * Label + control + hint + error (14px/22px form text, DESIGN.md §4). The control is rendered by
 * the caller with the ids passed in, so any input type works.
 *
 * Guidance (DESIGN.md §4a): `hint` is a rule or format the user must follow (always shown); `guide` explains a
 * concept in plain words (hidden when the user turns guides off); `help` is a glossary id for the (?) popover.
 */
export function FormField({
  label,
  hint,
  guide,
  help,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  guide?: ReactNode
  help?: string
  error?: ReactNode
  required?: boolean
  className?: string
  children: (control: FieldControlProps) => ReactNode
}) {
  const id = useId()
  const showGuides = usePreferences((s) => s.showGuides)
  const shown =
    guide && showGuides ? (
      hint ? (
        <>
          {hint} {guide}
        </>
      ) : (
        guide
      )
    ) : (
      hint
    )
  const hintId = shown ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1 text-form', className)}>
      <div className="flex items-center">
        <label
          htmlFor={id}
          className={cn(
            'block font-medium',
            required && "after:ml-0.5 after:text-destructive after:content-['*']",
          )}
        >
          {label}
        </label>
        {help && <FieldHelp term={help} />}
      </div>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {shown && (
        <p id={hintId} className="text-label text-muted-foreground">
          {shown}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-label text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Form-sized text input classes (14px, density-aware height). */
export const formInputClass = 'h-[calc(var(--control-h)+4px)] text-form'
