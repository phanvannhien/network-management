import { Toaster as Sonner } from 'sonner'
import { usePreferences } from '@/lib/preferences'

/** App-wide toasts (sonner) themed with the design tokens; call `toast()` from 'sonner'. */
export function Toaster() {
  const theme = usePreferences((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            '!bg-popover !text-popover-foreground !border-border !rounded-lg !text-[13px] !font-sans',
          description: '!text-muted-foreground',
        },
      }}
    />
  )
}
