import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Native <select> styled like Input: keyboard/screen-reader behaviour of the platform for free. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <span className="relative inline-flex w-full">
      <select
        {...props}
        className={cn(
          'h-(--control-h) w-full appearance-none rounded-md border border-input bg-card pr-8 pl-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}
