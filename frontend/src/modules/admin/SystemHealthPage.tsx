import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { useSession } from '@/app/auth'
import { useHealth } from '@/app/health'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { BackupState } from './BackupsPage'
import { sizeText as kib, useBackups } from './backups'

/**
 * Backups (P2-13): whether they are on, the newest good one (red after 2 days without), the recent runs with their
 * errors. Configuration stays in the environment (docs/OPERATIONS.md).
 */
function BackupsSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const q = useBackups(enabled)
  const b = q.data
  if (!b) return null
  const state = <BackupState b={b} />
  return (
    <section
      aria-label={t('backups.title')}
      className="max-w-3xl space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-base font-semibold">{t('backups.title')}</h2>
      {!b.enabled && <p className="text-sm text-muted-foreground">{t('backups.offGuide')}</p>}
      <KeyValueList
        columns={2}
        items={[
          { label: t('backups.state'), value: state },
          {
            label: t('backups.last'),
            value: b.lastGood
              ? `${formatDateTime(b.lastGood.startedAt)} · ${kib(b.lastGood.sizeBytes)}`
              : t('backups.never'),
          },
          {
            label: t('backups.schedule'),
            value:
              b.schedule === 'off'
                ? t('backups.scheduleOff')
                : t('backups.daily', { time: b.schedule }),
          },
          { label: t('backups.keep'), value: t('backups.keepValue', { keep: b.keep }) },
          { label: t('backups.dir'), value: <span className="font-mono text-tech">{b.dir}</span> },
        ]}
      />
      {b.runs.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">{t('backups.when')}</th>
              <th className="py-1 pr-2 font-medium">{t('backups.kind')}</th>
              <th className="py-1 pr-2 font-medium">{t('backups.result')}</th>
            </tr>
          </thead>
          <tbody>
            {b.runs.slice(0, 10).map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                <td className="py-1 pr-2">{t(`backups.kinds.${r.kind}`)}</td>
                <td className="py-1 pr-2">
                  {r.status === 'ok' ? (
                    <span>
                      {t('backups.done', { size: kib(r.sizeBytes) })}
                      {r.verified && ` · ${t('backups.verified')}`}
                    </span>
                  ) : r.status === 'running' ? (
                    t('backups.running')
                  ) : (
                    <span className="text-destructive">
                      {t('backups.failed')}: {r.error}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">{t('backups.howTo')}</p>
      <Link to="/admin/backups" className="text-sm text-primary hover:underline">
        {t('backups.manage')} →
      </Link>
    </section>
  )
}

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
      <BackupsSection enabled={!!session.data?.user.isSystemAdmin} />
    </div>
  )
}
