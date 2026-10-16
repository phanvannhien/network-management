import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { formatSize, usageLevel, usagePercent, type IpAssignment } from './ipam'

const FILL = {
  ok: 'bg-status-up',
  warn: 'bg-status-warning',
  critical: 'bg-status-down',
} as const

/** Used / usable addresses as a bar plus numbers; a word marks nearly full / full (never colour alone). */
export function UsageBar({
  used,
  size,
  label,
  className,
  barClassName,
}: {
  used: number
  size: number
  barClassName?: string
  /** What is measured, for the accessible name ("Sử dụng 10.72.114.0/24"). */
  label: string
  className?: string
}) {
  const { t } = useTranslation()
  const percent = usagePercent(used, size)
  const level = usageLevel(percent)
  // A few addresses in a big subnet round down to 0%: say "<1" so it does not read as empty.
  const shown = percent === 0 && used > 0 ? '<1' : String(percent)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('ipam.usageText', { used, size: formatSize(size), percent: shown })}
        className={cn('h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted', barClassName)}
      >
        <div className={cn('h-full', FILL[level])} style={{ width: `${percent}%` }} />
      </div>
      <span data-numeric className="truncate text-muted-foreground">
        {t('ipam.usageText', { used, size: formatSize(size), percent: shown })}
        {level === 'critical' && (
          <span className="ml-1 font-medium text-status-down">
            {percent >= 100 ? t('ipam.full') : t('ipam.nearlyFull')}
          </span>
        )}
      </span>
    </div>
  )
}

/** Small colour swatch + VLAN ID + name. */
export function VlanChip({
  vid,
  name,
  color,
}: {
  vid?: number | null
  name?: string
  color?: string
}) {
  const { t } = useTranslation()
  if (vid === undefined || vid === null)
    return <span className="text-muted-foreground">{t('common.none')}</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-sm border border-border"
        style={{ backgroundColor: color || undefined }}
      />
      <span className="font-mono text-tech">{vid}</span>
      {name && <span className="truncate text-muted-foreground">{name}</span>}
    </span>
  )
}

/** Who holds an address: a link to the device, or the cluster name (clusters are managed on member pages). */
export function HolderLink({ orgId, ip }: { orgId: string; ip: IpAssignment }) {
  const { t } = useTranslation()
  if (!ip.deviceId)
    return (
      <span className="font-medium" title={t('ipam.clusterIpHint')}>
        {ip.hostname}
      </span>
    )
  return (
    <Link
      to={`/o/${orgId}/devices/${ip.deviceId}`}
      className="font-medium hover:text-primary hover:underline"
    >
      {ip.hostname}
    </Link>
  )
}
