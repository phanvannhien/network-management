import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  /** Keys as shown, e.g. "Ctrl+D". */
  keys?: string
  danger?: boolean
  disabled?: boolean
  /** Draws a separator above the item. */
  separated?: boolean
  onSelect: () => void
}

/**
 * Right-click menu on the canvas (P1-16): every action also has a shortcut, the menu shows it. Keyboard: arrows move,
 * Enter picks, Esc closes; clicking elsewhere closes.
 */
export function NodeMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  /** Position inside the editor area. */
  x: number
  y: number
  label: string
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  const move = (dir: 1 | -1) => {
    const all = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ]
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    all[(i + dir + all.length) % all.length]?.focus()
  }
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: x, top: y }}
      className="absolute z-30 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') move(1)
        else if (e.key === 'ArrowUp') move(-1)
        else if (e.key === 'Escape') onClose()
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((it) => (
        <div key={it.id}>
          {it.separated && <div role="separator" className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
              it.danger && 'text-destructive',
            )}
          >
            {it.icon}
            <span className="flex-1">{it.label}</span>
            {it.keys && (
              <kbd className="font-mono text-[11px] text-muted-foreground">{it.keys}</kbd>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
