import type { PaginationState, SortingState } from '@tanstack/react-table'
import { FileSearch, PanelRightOpen } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams } from 'react-router'
import { useSession } from '@/app/auth'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FilterBar, type Facet } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAdminUsers, useMembers } from '@/modules/admin/members'
import i18n from '@/i18n'
import { actionKey, PERIOD_HOURS, useAuditLog, type AuditEntry, type Period } from './audit'

const ORG_CATEGORIES = ['member', 'organization'] as const
const SYSTEM_CATEGORIES = ['auth', 'mfa', 'account', 'user'] as const

const timeFmt = new Intl.DateTimeFormat('vi-VN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Readable action label; unknown actions (new modules) fall back to the raw name. */
function actionLabel(action: string): string {
  const key = actionKey(action)
  return i18n.exists(key) ? i18n.t(key as never) : action
}

const asObject = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v))

/** Field | Before | After, changed rows highlighted (snapshots are flat JSON objects). */
function SnapshotDiff({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation()
  const b = asObject(before)
  const a = asObject(after)
  if ((before != null && !b) || (after != null && !a)) {
    // Not an object: show both as-is.
    return (
      <div className="grid grid-cols-2 gap-3 font-mono text-tech">
        <pre className="rounded-md border border-border bg-muted p-2 whitespace-pre-wrap">
          {show(before)}
        </pre>
        <pre className="rounded-md border border-border bg-muted p-2 whitespace-pre-wrap">
          {show(after)}
        </pre>
      </div>
    )
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])]
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 rounded-md border border-border text-tech">
      <caption className="sr-only">
        {t('audit.before')} / {t('audit.after')}
      </caption>
      <thead className="bg-muted text-left text-label text-muted-foreground">
        <tr>
          <th scope="col" className="w-32 border-b border-border px-2 py-1 font-medium">
            {t('audit.field')}
          </th>
          <th scope="col" className="border-b border-border px-2 py-1 font-medium">
            {t('audit.before')}
          </th>
          <th scope="col" className="border-b border-border px-2 py-1 font-medium">
            {t('audit.after')}
          </th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {keys.length === 0 && (
          <tr>
            <td colSpan={3} className="px-2 py-2 font-sans text-muted-foreground">
              {t('audit.noSnapshot')}
            </td>
          </tr>
        )}
        {keys.map((k) => {
          const changed = b !== null && a !== null && JSON.stringify(b[k]) !== JSON.stringify(a[k])
          return (
            <tr
              key={k}
              data-changed={changed || undefined}
              className="align-top data-changed:bg-[color-mix(in_srgb,var(--status-warning)_10%,var(--surface))]"
            >
              <td className="border-b border-border px-2 py-1 break-words text-muted-foreground">
                {k}
                {changed && <span className="sr-only"> ({t('audit.changed')})</span>}
              </td>
              <td className="border-b border-border px-2 py-1 break-words">
                {b ? show(b[k]) : '—'}
              </td>
              <td className="border-b border-border px-2 py-1 break-words">
                {a ? show(a[k]) : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DetailsSheet({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="data-[side=right]:w-[640px] data-[side=right]:sm:max-w-[640px]">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle>{t('audit.detailsTitle', { id: entry.id })}</SheetTitle>
              <SheetDescription>{actionLabel(entry.action)}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4">
              <KeyValueList
                columns={1}
                wrap
                items={[
                  {
                    label: t('audit.time'),
                    value: (
                      <time dateTime={entry.createdAt}>
                        {timeFmt.format(new Date(entry.createdAt))}
                      </time>
                    ),
                  },
                  {
                    label: t('audit.actor'),
                    value: entry.actor
                      ? `${entry.actor.displayName || entry.actor.email} · ${entry.actor.email}`
                      : t('audit.anonymous'),
                  },
                  {
                    label: t('audit.action'),
                    value: <span className="font-mono text-tech">{entry.action}</span>,
                  },
                  {
                    label: t('audit.object'),
                    value: (
                      <span className="font-mono text-tech">
                        {entry.objectType}
                        {entry.objectId && ` · ${entry.objectId}`}
                      </span>
                    ),
                  },
                  {
                    label: t('audit.ip'),
                    value: entry.ip ? (
                      <TechText value={entry.ip} label={t('audit.ip')} alwaysCopy />
                    ) : (
                      '—'
                    ),
                  },
                  { label: t('audit.userAgent'), value: entry.userAgent || '—' },
                  {
                    label: t('audit.requestId'),
                    value: entry.requestId ? (
                      <TechText value={entry.requestId} label={t('audit.requestId')} />
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
              <SnapshotDiff before={entry.before} after={entry.after} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Picks only the newest choice for facets the API takes as a single value (period, actor). */
function single(next: string[] | undefined, prev: string[] | undefined): string[] {
  if (!next || next.length <= 1) return next ?? []
  return next.filter((v) => !(prev ?? []).includes(v)).slice(-1)
}

/**
 * Audit log (P1-05, SRS §10): organization scope for owner/admin, or the system scope (events
 * without an organization) for system admins. Server-paginated, newest first; details in a sheet.
 */
export function AuditLogPage({ scope }: { scope: 'org' | 'system' }) {
  const { t } = useTranslation()
  const { orgId } = useParams()
  const session = useSession()
  const org = useOrganization(scope === 'org' ? (orgId ?? '') : '')
  const userId = session.data?.user.id ?? ''
  const isSystem = scope === 'system'
  useBreadcrumbs([{ label: isSystem ? t('audit.systemTitle') : t('audit.title') }])

  const members = useMembers(isSystem ? '' : (orgId ?? ''))
  const users = useAdminUsers(isSystem)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [from, setFrom] = useState<string | undefined>(undefined)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const q = useDeferredValue(filter.q.trim())

  const log = useAuditLog(isSystem ? undefined : orgId, {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    q,
    categories: filter.facets.category ?? [],
    actorId: filter.facets.actor?.[0],
    from,
  })

  const people = useMemo(
    () =>
      isSystem
        ? (users.data ?? []).map((u) => ({ value: u.id, label: u.displayName || u.email }))
        : (members.data ?? []).map((m) => ({ value: m.userId, label: m.displayName || m.email })),
    [isSystem, users.data, members.data],
  )

  if (isSystem && session.data && !session.data.user.isSystemAdmin)
    return <Navigate to="/" replace />
  const role = org.data?.membership.role
  if (!isSystem && org.data && role !== 'owner' && role !== 'admin')
    return <Navigate to={`/o/${orgId}`} replace />

  const facets: Facet[] = [
    {
      id: 'category',
      label: t('audit.category'),
      options: (isSystem ? SYSTEM_CATEGORIES : ORG_CATEGORIES).map((c) => ({
        value: c,
        label: t(`audit.categories.${c}`),
      })),
    },
    {
      id: 'period',
      label: t('audit.period'),
      options: (Object.keys(PERIOD_HOURS) as Period[]).map((p) => ({
        value: p,
        label: t(`audit.periods.${p}`),
      })),
    },
    { id: 'actor', label: t('audit.actor'), options: people },
  ]

  const onFilter = (next: FilterState) => {
    const facetsNext = {
      ...next.facets,
      period: single(next.facets.period, filter.facets.period),
      actor: single(next.facets.actor, filter.facets.actor),
    }
    const period = facetsNext.period[0] as Period | undefined
    // Resolve the period once per change (not per render) so the query key stays stable.
    setFrom(
      period ? new Date(Date.now() - PERIOD_HOURS[period] * 3_600_000).toISOString() : undefined,
    )
    setFilter({ ...next, facets: facetsNext })
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }

  const columns: DataColumn<AuditEntry>[] = [
    {
      id: 'createdAt',
      header: t('audit.time'),
      enableSorting: false,
      meta: { label: t('audit.time'), width: 170, pin: true, alwaysVisible: true },
      cell: ({ row }) => (
        <time dateTime={row.original.createdAt} data-numeric>
          {timeFmt.format(new Date(row.original.createdAt))}
        </time>
      ),
    },
    {
      id: 'actor',
      header: t('audit.actor'),
      enableSorting: false,
      meta: { label: t('audit.actor'), width: 220 },
      cell: ({ row: { original: e } }) =>
        e.actor ? (
          <div className="leading-tight">
            <span className="font-medium">{e.actor.displayName || e.actor.email}</span>
            <div className="text-label text-muted-foreground">{e.actor.email}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">{t('audit.anonymous')}</span>
        ),
    },
    {
      id: 'action',
      header: t('audit.action'),
      enableSorting: false,
      meta: { label: t('audit.action'), width: 220 },
      cell: ({ row }) => (
        <span
          className={
            row.original.action.endsWith('_failed') || row.original.action.endsWith('_rate_limited')
              ? 'text-status-down'
              : undefined
          }
        >
          {actionLabel(row.original.action)}
        </span>
      ),
    },
    {
      id: 'object',
      header: t('audit.object'),
      enableSorting: false,
      meta: { label: t('audit.object'), width: 260 },
      cell: ({ row: { original: e } }) => (
        <span className="font-mono text-tech">
          <span className="text-muted-foreground">{e.objectType}</span>
          {e.objectId && ` ${e.objectId}`}
        </span>
      ),
    },
    {
      id: 'ip',
      header: t('audit.ip'),
      enableSorting: false,
      meta: { label: t('audit.ip'), width: 130 },
      cell: ({ row }) =>
        row.original.ip ? <TechText value={row.original.ip} label={t('audit.ip')} /> : null,
    },
    {
      id: 'details',
      header: () => <span className="sr-only">{t('audit.details')}</span>,
      enableSorting: false,
      meta: { label: t('audit.details'), width: 48, alwaysVisible: true, align: 'right' },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSelected(row.original)}
          aria-label={`${t('audit.details')} #${row.original.id}`}
          title={t('audit.details')}
        >
          <PanelRightOpen aria-hidden />
        </Button>
      ),
    },
  ]

  const noSorting: SortingState = []
  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={isSystem ? t('audit.systemTitle') : t('audit.title')}
        count={log.data?.total}
        description={isSystem ? t('audit.systemHint') : t('audit.orgHint')}
      />
      <DataTable
        tableId={isSystem ? 'audit-system' : 'audit-org'}
        userId={userId}
        caption={isSystem ? t('audit.systemTitle') : t('audit.title')}
        columns={columns}
        data={log.data?.entries}
        total={log.data?.total ?? 0}
        isLoading={log.isPending}
        error={log.error}
        getRowId={(e) => String(e.id)}
        rowLabel={(e) => `#${e.id}`}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={noSorting}
        onSortingChange={() => {}}
        maxHeight="calc(100vh - 240px)"
        filters={
          <FilterBar
            value={filter}
            onChange={onFilter}
            facets={facets}
            searchPlaceholder={t('audit.searchPlaceholder')}
            storageKey={`ntb-filters:${userId}:${isSystem ? 'audit-system' : 'audit-org'}`}
          />
        }
        empty={<EmptyState icon={<FileSearch />} title={t('audit.emptyTitle')} />}
      />
      <DetailsSheet entry={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
