import { cn } from '@/lib/utils'
import { CopyButton } from './CopyButton'

/**
 * Technical value in IBM Plex Mono — only IP, MAC, S/N, part number, port name, VLAN ID
 * (DESIGN.md §4). The copy button appears on hover/focus, or always with `alwaysCopy`.
 */
export function TechText({
  value,
  label,
  copy = true,
  alwaysCopy = false,
  className,
}: {
  value: string
  /** Field name for the copy button's accessible name. */
  label: string
  copy?: boolean
  alwaysCopy?: boolean
  className?: string
}) {
  return (
    <span className={cn('group/tech inline-flex max-w-full items-center gap-1', className)}>
      <span className="truncate font-mono text-tech">{value}</span>
      {copy && value && (
        <CopyButton
          value={value}
          label={label}
          className={cn(
            !alwaysCopy &&
              'opacity-0 group-hover/tech:opacity-100 focus-visible:opacity-100 group-has-[:focus-visible]/tech:opacity-100',
          )}
        />
      )}
    </span>
  )
}
