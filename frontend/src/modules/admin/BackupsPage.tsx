import { Download, Pencil, Play, Plug, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { MfaPrompt } from '@/modules/vault/SecretField'
import { MfaNeeded } from '@/modules/vault/vault'
import { BackupTargetDialog } from './BackupTargetDialog'
import {
  downloadBackup,
  sizeText,
  useBackups,
  useDeleteTarget,
  useRunBackup,
  useTestTarget,
  type BackupStatus,
  type BackupTarget,
} from './backups'
import { useHelpTopic } from '@/help/topic'

/** Where a destination writes, in one line. */
function whereOf(t: BackupTarget): string {
  const s = t.settings
  switch (t.kind) {
    case 'local':
      return s.path ?? ''
    case 'sftp':
      return `${s.user ?? ''}@${s.host ?? ''}${s.port ? `:${s.port}` : ''}/${s.path ?? ''}`
    case 's3':
      return `${s.provider ?? ''} · ${s.bucket ?? ''}/${s.path ?? ''}`
    default:
      return s.path || '/'
  }
}

/** Backup state badge, shared with the system health page. */
export function BackupState({ b }: { b: BackupStatus }) {
  const { t } = useTranslation()
  const failing = b.targets.filter((x) => x.enabled && x.lastStatus === 'failed').length
  if (!b.enabled) return <StatusBadge status="down" label={t('backups.off')} />
  if (b.stale) return <StatusBadge status="down" label={t('backups.stale')} />
  if (failing > 0)
    return <StatusBadge status="warning" label={t('backups.targetsFailing', { count: failing })} />
  return <StatusBadge status="up" label={t('backups.ok')} />
}

/**
 * System area › backups (P2-13, ADR-053): state, run now, destinations (NAS / SFTP / S3 / Drive…), the backups on the
 * server (download with a fresh MFA code) and the recent runs. The passphrase and schedule stay in the environment.
 */
export function BackupsPage() {
  const { t } = useTranslation()
  const session = useSession()
  const [running, setRunning] = useState(false)
  const q = useBackups(session.data?.user.isSystemAdmin === true, running)
  const run = useRunBackup()
  const test = useTestTarget()
  const del = useDeleteTarget()
  const [editing, setEditing] = useState<BackupTarget | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BackupTarget | null>(null)
  const [askMfa, setAskMfa] = useState<string | null>(null)
  useBreadcrumbs([{ label: t('backups.title') }])
  useHelpTopic('sao-luu-khoi-phuc')
  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />
  const b = q.data
  if (!b) return <Skeleton className="m-4 h-64" />
  if (running && b.runs[0]?.status !== 'running' && !run.isPending) setRunning(false)

  const doTest = (target: BackupTarget) =>
    test.mutate(target.id, {
      onSuccess: (r) =>
        r.ok ? toast.success(r.message) : toast.error(r.message, { duration: 15_000 }),
      onError: (err) => toast.error(err.message),
    })
  const download = async (name: string) => {
    try {
      await downloadBackup(name)
    } catch (err) {
      if (err instanceof MfaNeeded) setAskMfa(name)
      else toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title={t('backups.title')}
        description={t('backups.intro')}
        actions={
          <Button
            disabled={!b.enabled || run.isPending || b.runs[0]?.status === 'running'}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: () => {
                  setRunning(true)
                  toast.success(t('backups.started'))
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            <Play aria-hidden /> {t('backups.runNow')}
          </Button>
        }
      />
      <section
        aria-label={t('backups.state')}
        className="max-w-4xl space-y-2 rounded-lg border border-border bg-card p-4"
      >
        {!b.enabled && <p className="text-sm text-muted-foreground">{t('backups.offGuide')}</p>}
        <KeyValueList
          columns={2}
          items={[
            { label: t('backups.state'), value: <BackupState b={b} /> },
            {
              label: t('backups.last'),
              value: b.lastGood
                ? `${formatDateTime(b.lastGood.startedAt)} · ${sizeText(b.lastGood.sizeBytes)}`
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
            {
              label: t('backups.dir'),
              value: <span className="font-mono text-tech">{b.dir}</span>,
            },
          ]}
        />
      </section>

      <section
        aria-label={t('backups.targets')}
        className="max-w-4xl space-y-2 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t('backups.targets')}</h2>
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('backups.target.add')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('backups.targetsGuide')}</p>
        {b.targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('backups.noTargets')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">{t('backups.target.name')}</th>
                <th className="py-1 pr-2 font-medium">{t('backups.where')}</th>
                <th className="py-1 pr-2 font-medium">{t('backups.lastSent')}</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {b.targets.map((x) => (
                <tr key={x.id} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{x.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`backups.kinds2.${x.kind}`)}
                      {!x.enabled && ` · ${t('backups.disabled')}`}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-xs break-all">{whereOf(x)}</td>
                  <td className="py-1.5 pr-2 text-xs">
                    {x.lastStatus === '' ? (
                      <span className="text-muted-foreground">{t('backups.notYet')}</span>
                    ) : x.lastStatus === 'ok' ? (
                      <span>
                        {t('backups.sentAt', { time: x.lastAt ? formatDateTime(x.lastAt) : '' })}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        {t('backups.failed')}: {x.lastError}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={test.isPending}
                      onClick={() => doTest(x)}
                    >
                      <Plug aria-hidden /> {t('backups.test')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('common.edit')}
                      onClick={() => setEditing(x)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('common.delete')}
                      onClick={() => setDeleting(x)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        aria-label={t('backups.files')}
        className="max-w-4xl space-y-2 rounded-lg border border-border bg-card p-4"
      >
        <h2 className="text-base font-semibold">{t('backups.files')}</h2>
        <p className="text-sm text-muted-foreground">{t('backups.filesGuide')}</p>
        {b.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('backups.never')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {b.files.map((f) => (
                <tr key={f.name} className="border-t border-border first:border-t-0">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(f.createdAt)}</td>
                  <td className="py-1.5 pr-2">
                    {t(`backups.kinds.${f.kind as 'manual'}`, { defaultValue: f.kind })}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{sizeText(f.sizeBytes)}</td>
                  <td className="py-1.5 pr-2 text-xs">
                    {f.sameKey ? (
                      <span className="text-muted-foreground">{t('backups.sameKey')}</span>
                    ) : (
                      <span className="text-status-warning">{t('backups.otherKey')}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => void download(f.name)}>
                      <Download aria-hidden /> {t('backups.download')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {b.runs.length > 0 && (
        <section
          aria-label={t('backups.history')}
          className="max-w-4xl space-y-2 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-base font-semibold">{t('backups.history')}</h2>
          <table className="w-full text-sm">
            <tbody>
              {b.runs.map((r) => (
                <tr key={r.id} className="border-t border-border align-top first:border-t-0">
                  <td className="py-1 pr-2 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                  <td className="py-1 pr-2">{t(`backups.kinds.${r.kind}`)}</td>
                  <td className="py-1 pr-2">
                    {r.status === 'ok' ? (
                      <span>
                        {t('backups.done', { size: sizeText(r.sizeBytes) })}
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
        </section>
      )}

      {editing && (
        <BackupTargetDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            doTest(saved)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title={t('backups.deleteTitle', { name: deleting.name })}
          description={t('backups.deleteBody')}
          confirmLabel={t('common.delete')}
          pending={del.isPending}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
              onError: (err) => toast.error(err.message),
            })
          }
          onOpenChange={(o) => !o && setDeleting(null)}
        />
      )}
      {askMfa && (
        <MfaPrompt
          onClose={() => setAskMfa(null)}
          onConfirmed={() => {
            const name = askMfa
            setAskMfa(null)
            void download(name)
          }}
        />
      )}
    </div>
  )
}
