import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { useSession } from '@/app/auth'
import { useHealth } from '@/app/health'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'

/** System area › health: API/database state, version and environment (moved off business pages). */
export function SystemHealthPage() {
  const { t } = useTranslation()
  const session = useSession()
  const health = useHealth()
  useBreadcrumbs([{ label: t('health.title') }])
  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />

  const h = health.data
  const api = health.isError ? (
    <StatusBadge status="down" label={t('health.unreachable')} />
  ) : h ? (
    <StatusBadge status={h.status === 'ok' ? 'up' : 'warning'} label={t(`health.${h.status}`)} />
  ) : (
    <StatusBadge status="unknown" />
  )
  const db = h ? (
    <StatusBadge status={h.database === 'ok' ? 'up' : 'down'} label={t(`health.${h.database}`)} />
  ) : (
    <StatusBadge status="unknown" />
  )

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('health.title')}
        description={
          health.dataUpdatedAt
            ? t('health.checkedAt', {
                time: formatDateTime(new Date(health.dataUpdatedAt).toISOString()),
              })
            : undefined
        }
        actions={
          <Button
            variant="outline"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
          >
            <RefreshCw aria-hidden className={health.isFetching ? 'animate-spin' : undefined} />{' '}
            {t('health.refresh')}
          </Button>
        }
      />
      <section
        aria-label={t('health.title')}
        className="max-w-3xl rounded-lg border border-border bg-card p-4"
      >
        <KeyValueList
          columns={2}
          items={[
            { label: t('health.api'), value: api },
            { label: t('health.database'), value: db },
            {
              label: t('health.version'),
              value: <span className="font-mono text-tech">{h?.version ?? '—'}</span>,
            },
            { label: t('health.environment'), value: h?.environment ?? '—' },
          ]}
        />
      </section>
    </div>
  )
}
