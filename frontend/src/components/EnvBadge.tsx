import { useTranslation } from 'react-i18next'
import { useHealth } from '@/app/health'
import { cn } from '@/lib/utils'

/** Shown only outside production (DESIGN.md §6): amber outline + name, e.g. "Development". */
export function EnvBadge({ compact, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation()
  const env = useHealth().data?.environment
  if (!env || env === 'production') return null
  const name =
    env === 'development' ? t('env.development') : env === 'staging' ? t('env.staging') : env
  return (
    <span
      title={t('env.title', { name })}
      className={cn(
        'inline-flex h-5 items-center rounded-sm border border-status-warning px-1.5 text-[11px] font-semibold text-status-warning',
        className,
      )}
    >
      {compact ? name.slice(0, 3).toUpperCase() : name}
    </span>
  )
}
