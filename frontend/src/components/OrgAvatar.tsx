import { ShieldCheck } from 'lucide-react'
import { orgColor, orgInitials } from '@/lib/orgAvatar'
import { cn } from '@/lib/utils'

/** Initials on the organization's fixed colour; 1px control border keeps it visible in Dark. */
export function OrgAvatar({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string
  name: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: orgColor(id) }}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-md font-semibold text-white dark:ring-1 dark:ring-border-control',
        size === 'sm' ? 'size-5 text-[10px]' : 'size-6 text-[11px]',
        className,
      )}
    >
      {orgInitials(name)}
    </span>
  )
}

/** Badge for the system area: never looks like an organization (DESIGN.md §6). */
export function SystemAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid size-6 shrink-0 place-items-center rounded-md bg-system text-system-fg',
        className,
      )}
    >
      <ShieldCheck className="size-4" />
    </span>
  )
}
