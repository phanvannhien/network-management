import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMarkNotificationsSeen, useNotifications } from './alerts'

/**
 * The bell (P2-05): expiry milestones reached by devices of the organization the user can see; opening it marks
 * them read. Outside an organization there is nothing to show.
 */
export function NotificationBell() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const list = useNotifications(orgId)
  const seen = useMarkNotificationsSeen(orgId)
  const unread = list.data?.unread ?? 0
  const items = list.data?.notifications ?? []
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && unread > 0) seen.mutate()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unread > 0
                ? t('notifications.unreadLabel', { count: unread })
                : t('topbar.notifications')
            }
          />
        }
      >
        <Bell aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-status-down px-1 text-[10px] leading-4 font-semibold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">{t('notifications.title')}</span>
          {orgId && (
            <Link to={`/o/${orgId}/alerts`} className="text-xs text-primary hover:underline">
              {t('notifications.settings')}
            </Link>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t('topbar.noNotifications')}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn('px-3 py-2 text-sm', n.unread && 'bg-muted/50')}>
                <Link
                  to={
                    n.contractId
                      ? `/o/${orgId}/contracts/${n.contractId}`
                      : `/o/${orgId}/devices/${n.deviceId}`
                  }
                  className={
                    n.contractId
                      ? 'font-medium hover:underline'
                      : 'font-mono text-tech hover:underline'
                  }
                >
                  {n.hostname}
                </Link>{' '}
                <span className="text-muted-foreground">({n.siteCode})</span>
                <span className="block">
                  {t(`alerts.kindValues.${n.kind}`)}: {formatDate(n.dueDate)}{' '}
                  <span
                    className={n.milestone === 0 ? 'text-status-down' : 'text-muted-foreground'}
                  >
                    ·{' '}
                    {n.milestone === 0
                      ? t('notifications.passed')
                      : t('notifications.within', { count: n.milestone })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
