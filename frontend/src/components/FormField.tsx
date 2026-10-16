import { useId, type ReactNode } from 'react'
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
 */
export function FormField({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: (control: FieldControlProps) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1 text-form', className)}>
      <label
        htmlFor={id}
        className={cn(
          'block font-medium',
          required && "after:ml-0.5 after:text-destructive after:content-['*']",
        )}
      >
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-label text-muted-foreground">
          {hint}
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
