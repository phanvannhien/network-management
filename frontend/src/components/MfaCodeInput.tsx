import { useRef, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * 6-digit TOTP field: numeric keypad, one-time-code autofill, digits only, and `onComplete` fires
 * as soon as the sixth digit is in (auto-submit, DESIGN.md §8b).
 */
export function MfaCodeInput({
  value,
  onChange,
  onComplete,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  onComplete?: (code: string) => void
}) {
  const lastSubmitted = useRef<string | null>(null)
  return (
    <Input
      {...props}
      value={value}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      spellCheck={false}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(digits)
        // Fire once per distinct complete code (paste, autofill or typing the 6th digit).
        if (digits.length === 6 && lastSubmitted.current !== digits) {
          lastSubmitted.current = digits
          onComplete?.(digits)
        }
        if (digits.length < 6) lastSubmitted.current = null
      }}
      className={cn('h-11 text-center font-mono text-xl tracking-[0.4em] tabular-nums', className)}
    />
  )
}
