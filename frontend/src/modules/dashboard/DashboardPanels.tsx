import {
  AlertTriangle,
  CalendarClock,
  CircleX,
  Info,
  ListX,
  Network,
  RefreshCw,
  Server,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FieldHelp } from '@/components/FieldHelp'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { useScope } from '@/modules/sites/access'
import { useDashboard, type Dashboard, type DashboardProblem } from './dashboard'

/** A small table block with a title, an optional guide line and "see all" (DESIGN.md §7c: tables, not big cards). */
function Block({
  title,
  guide,
  more,
  children,
}: {
  title: ReactNode
  guide?: string
  more?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="flex items-center gap-1 text-sm font-semibold">{title}</h2>
        {more}
      </div>
      {guide && <p className="px-3 pt-2 text-xs text-muted-foreground">{guide}</p>}
      <div className="p-3 pt-2">{children}</div>
    </section>
  )
}

/** A thin horizontal bar: the share of the largest row. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div aria-hidden className="h-1 w-full rounded-full bg-muted">
      <div
        className="h-1 rounded-full bg-primary"
        style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }}
      />
    </div>
  )
}

const severityIcon = {
  error: <CircleX className="size-4" style={{ color: 'var(--status-down)' }} />,
  warning: <AlertTriangle className="size-4" style={{ color: 'var(--status-warning)' }} />,
  info: <Info className="size-4 text-muted-foreground" />,
}

/** Where a problem is looked at: the list filtered on it, the device, the subnet. */
function problemLink(base: string, p: DashboardProblem): string | null {
  switch (p.kind) {
    case 'duplicate_ip':
      return `${base}/devices?q=${encodeURIComponent(p.subject.split(' ')[0] ?? '')}`
    case 'duplicate_hostname':
    case 'duplicate_serial':
      return `${base}/devices?q=${encodeURIComponent(p.subject)}`
    case 'port_multi_link':
      return p.deviceId ? `${base}/devices/${p.deviceId}` : null
    case 'subnet_full':
      return p.subnetId ? `${base}/ipam/subnets/${p.subnetId}` : null
    default:
      return null
  }
}

function SitesBlock({ base, data }: { base: string; data: Dashboard }) {
  const { t } = useTranslation()
  const max = Math.max(0, ...data.bySite.map((s) => s.total))
  return (
    <Block
      title={t('dashboard.bySite')}
      more={
        <Link to={`${base}/sites`} className="text-xs text-primary hover:underline">
          {t('dashboard.seeAll')}
        </Link>
      }
    >
      {data.bySite.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noSites')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{t('dashboard.site')}</th>
              <th className="py-1 text-right font-medium">{t('dashboard.total')}</th>
              <th className="py-1 text-right font-medium">{t('devices.lifecycleValues.active')}</th>
              <th className="py-1 text-right font-medium">
                {t('devices.lifecycleValues.planned')}
              </th>
              <th className="py-1 text-right font-medium">{t('dashboard.spareRma')}</th>
            </tr>
          </thead>
          <tbody>
            {data.bySite.slice(0, 12).map((s) => (
              <tr key={s.siteId} className="border-t border-border">
                <td className="py-1.5 pr-2">
                  <Link
                    to={`${base}/devices?site=${s.siteId}`}
                    className="font-mono text-tech hover:underline"
                    title={s.name}
                  >
                    {s.code}
                  </Link>
                  <Bar value={s.total} max={max} />
                </td>
                <td data-numeric className="py-1.5 text-right font-medium">
                  {s.total}
                </td>
                <td data-numeric className="py-1.5 text-right">
                  {s.active}
                </td>
                <td data-numeric className="py-1.5 text-right">
                  {s.planned}
                </td>
                <td data-numeric className="py-1.5 text-right">
                  {s.spare + s.rma}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function ProblemsBlock({ base, data }: { base: string; data: Dashboard }) {
  const { t } = useTranslation()
  return (
    <Block title={t('dashboard.problems')} guide={t('dashboard.problemsGuide')}>
      {data.problems.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noProblems')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data.problems.slice(0, 12).map((p, i) => {
            const to = problemLink(base, p)
            return (
              <li key={`${p.kind}-${p.subject}-${i}`} className="flex items-center gap-2 py-1.5">
                <span aria-label={t(`dashboard.severity.${p.severity}`)} className="shrink-0">
                  {severityIcon[p.severity]}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {t(`dashboard.problem.${p.kind}`, {
                    subject: p.subject,
                    detail: p.detail,
                    count: p.count,
                  })}
                </span>
                {to && (
                  <Link to={to} className="shrink-0 text-xs text-primary hover:underline">
                    {t('dashboard.open')}
                  </Link>
                )}
              </li>
            )
          })}
          {data.problems.length > 12 && (
            <li className="py-1.5 text-xs text-muted-foreground">
              {t('dashboard.moreProblems', { count: data.problems.length - 12 })}
            </li>
          )}
        </ul>
      )}
    </Block>
  )
}

function TypesBlock({ base, data }: { base: string; data: Dashboard }) {
  const { t } = useTranslation()
  const max = Math.max(0, ...data.byType.map((x) => x.count))
  return (
    <Block title={t('dashboard.byType')}>
      {data.byType.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noDevices')}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {data.byType.slice(0, 10).map((x) => (
              <tr key={x.type} className="border-t border-border first:border-t-0">
                <td className="w-1/2 py-1.5 pr-2">
                  <Link to={`${base}/devices?type=${x.type}`} className="hover:underline">
                    {t(`devices.types.${x.type}`)}
                  </Link>
                </td>
                <td className="py-1.5 pr-2">
                  <Bar value={x.count} max={max} />
                </td>
                <td data-numeric className="w-12 py-1.5 text-right">
                  {x.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function ExpiringBlock({ base, data }: { base: string; data: Dashboard }) {
  const { t } = useTranslation()
  return (
    <Block
      title={
        <>
          {t('dashboard.expiring')}
          <FieldHelp term="eol" />
        </>
      }
      guide={
        t('dashboard.expiringGuide') +
        (data.totals.expired > 0
          ? ' ' + t('dashboard.expiredNote', { count: data.totals.expired })
          : '')
      }
    >
      {data.expiring.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noExpiring')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{t('dashboard.kind')}</th>
              <th className="py-1 font-medium">{t('dashboard.device')}</th>
              <th className="py-1 font-medium">{t('dashboard.date')}</th>
              <th className="py-1 text-right font-medium">{t('dashboard.left')}</th>
            </tr>
          </thead>
          <tbody>
            {data.expiring.slice(0, 10).map((e) => (
              <tr key={`${e.deviceId}-${e.kind}`} className="border-t border-border">
                <td className="py-1.5 pr-2">{t(`dashboard.expiryKind.${e.kind}`)}</td>
                <td className="py-1.5 pr-2">
                  <Link
                    to={`${base}/devices/${e.deviceId}`}
                    className="font-mono text-tech hover:underline"
                  >
                    {e.hostname}
                  </Link>
                </td>
                <td data-numeric className="py-1.5 pr-2">
                  {new Date(`${e.date}T00:00:00`).toLocaleDateString('vi-VN')}
                </td>
                <td
                  data-numeric
                  className="py-1.5 text-right"
                  style={e.days < 0 ? { color: 'var(--status-down)' } : undefined}
                >
                  {e.days < 0
                    ? t('dashboard.overdue', { count: -e.days })
                    : t('dashboard.daysLeft', { count: e.days })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function MissingBlock({ base, data }: { base: string; data: Dashboard }) {
  const { t } = useTranslation()
  return (
    <Block
      title={t('dashboard.missing', { count: data.totals.missingInfo })}
      guide={t('dashboard.missingGuide')}
    >
      {data.missingInfo.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noMissing')}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {data.missingInfo.map((d) => (
              <tr key={d.id} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-2">
                  <Link
                    to={`${base}/devices/${d.id}`}
                    className="font-mono text-tech hover:underline"
                  >
                    {d.hostname}
                  </Link>
                </td>
                <td className="py-1.5 pr-2 font-mono text-tech text-muted-foreground">
                  {d.siteCode}
                </td>
                <td className="py-1.5 text-right text-xs text-muted-foreground">
                  {d.missing.map((m) => t(`dashboard.field.${m}`)).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.totals.missingInfo > data.missingInfo.length && (
        <p className="pt-2 text-xs text-muted-foreground">
          {t('dashboard.moreMissing', { count: data.totals.missingInfo - data.missingInfo.length })}
        </p>
      )}
    </Block>
  )
}

/**
 * Dashboard (P1-24, DESIGN.md §7c): a line of figures, then small tables — devices by site, problems to fix, devices
 * by type, dates coming up, devices missing information. Follows the topbar category.
 */
export function DashboardPanels({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const scope = useScope(orgId)
  const q = useDashboard(orgId, scope.categoryId)
  const base = `/o/${orgId}`
  if (q.isError)
    return (
      <p role="alert" className="text-destructive">
        {q.error.message}
      </p>
    )
  if (!q.data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  const d = q.data
  const tot = d.totals
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {t('dashboard.updated', { time: formatDateTime(d.generatedAt) })}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('dashboard.refresh')}
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={q.isFetching ? 'animate-spin' : undefined} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('dashboard.devices')}
          value={tot.devices}
          icon={<Server className="size-3.5" />}
          to={`${base}/devices`}
        />
        <StatCard
          label={t('dashboard.errors')}
          value={tot.errors}
          icon={<CircleX className="size-3.5" />}
          tone={tot.errors > 0 ? 'down' : undefined}
        />
        <StatCard
          label={t('dashboard.warnings')}
          value={tot.warnings}
          icon={<AlertTriangle className="size-3.5" />}
          tone={tot.warnings > 0 ? 'warning' : undefined}
        />
        <StatCard
          label={t('dashboard.expiringShort')}
          value={tot.expiring}
          icon={<CalendarClock className="size-3.5" />}
        />
        <StatCard
          label={t('dashboard.missingShort')}
          value={tot.missingInfo}
          icon={<ListX className="size-3.5" />}
        />
        <StatCard
          label={t('dashboard.subnetsFull')}
          value={tot.subnetsFull}
          icon={<Network className="size-3.5" />}
          to={`${base}/ipam`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SitesBlock base={base} data={d} />
        <ProblemsBlock base={base} data={d} />
        <TypesBlock base={base} data={d} />
        <ExpiringBlock base={base} data={d} />
        <MissingBlock base={base} data={d} />
      </div>
    </div>
  )
}
