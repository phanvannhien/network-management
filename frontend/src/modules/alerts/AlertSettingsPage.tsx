import { BellRing, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ALERT_KINDS, useAlertSettings, useSaveAlertSettings, type AlertSettings } from './alerts'
import { useHelpTopic } from '@/help/topic'

/**
 * Organization › expiry alerts (P2-05, ADR-043): what is announced (warranty, license, vendor end of support), how
 * many days before, who gets the daily digest. Only devices with such a date are concerned.
 */
export function AlertSettingsPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const settings = useAlertSettings(orgId)
  useBreadcrumbs([{ label: t('alerts.title') }])
  useHelpTopic('nha-cung-cap#canh-bao-het-han')
  const s = settings.data
  if (settings.isError) return <p className="p-4 text-status-down">{settings.error.message}</p>
  if (!s) return <Skeleton className="m-4 h-64" />
  // Keyed on the version: after a save elsewhere (or a 409 and a reload) the form starts from the stored values.
  return (
    <AlertSettingsForm
      key={s.version}
      orgId={orgId}
      s={s}
      onStale={() => void settings.refetch()}
    />
  )
}

function AlertSettingsForm({
  orgId,
  s,
  onStale,
}: {
  orgId: string
  s: AlertSettings
  onStale: () => void
}) {
  const { t } = useTranslation()
  const save = useSaveAlertSettings(orgId)
  const [f, setF] = useState(() => ({
    enabled: s.enabled,
    kinds: s.kinds,
    milestones: s.milestones.join(', '),
    emailAdmins: s.emailAdmins,
    extraEmails: s.extraEmails.join('\n'),
  }))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const milestones = f.milestones
      .split(/[,;\s]+/)
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0)
    save.mutate(
      {
        enabled: f.enabled,
        kinds: f.kinds,
        milestones,
        emailAdmins: f.emailAdmins,
        extraEmails: f.extraEmails
          .split(/[\n,;]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        version: s.version,
      },
      {
        onSuccess: () => toast.success(t('alerts.saved')),
        onError: (err) => {
          toast.error(err.message)
          // Saved by someone else meanwhile (409): reload, the form restarts from what is stored.
          onStale()
        },
      },
    )
  }
  const check = (on: boolean, label: string, onChange: (v: boolean) => void, guide?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {guide && <span className="block text-xs text-muted-foreground">{guide}</span>}
      </span>
    </label>
  )

  return (
    <div className="space-y-3 p-4">
      <PageHeader title={t('alerts.title')} description={t('alerts.intro')} />
      {!s.smtpConfigured && (
        <p
          role="note"
          className="flex max-w-3xl items-start gap-2 rounded-md border border-status-warning p-3 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-warning" />
          {t('alerts.noSmtp')}
        </p>
      )}
      <form
        onSubmit={onSubmit}
        aria-label={t('alerts.title')}
        className="max-w-3xl space-y-4 rounded-lg border border-border bg-card p-4"
      >
        {check(f.enabled, t('alerts.enabled'), (v) => setF({ ...f, enabled: v }))}
        <fieldset disabled={!f.enabled} className="space-y-4 disabled:opacity-60">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('alerts.kinds')}</legend>
            <p className="text-xs text-muted-foreground">{t('alerts.kindsGuide')}</p>
            {ALERT_KINDS.map((k) => (
              <div key={k}>
                {check(
                  f.kinds.includes(k),
                  t(`alerts.kindValues.${k}`),
                  (v) =>
                    setF({ ...f, kinds: v ? [...f.kinds, k] : f.kinds.filter((x) => x !== k) }),
                  t(`alerts.kindGuides.${k}`),
                )}
              </div>
            ))}
          </fieldset>
          <FormField label={t('alerts.milestones')} guide={t('alerts.milestonesGuide')}>
            {(p) => (
              <Input
                {...p}
                value={f.milestones}
                placeholder="90, 60, 30, 7"
                onChange={(e) => setF({ ...f, milestones: e.target.value })}
              />
            )}
          </FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('alerts.recipients')}</legend>
            {check(f.emailAdmins, t('alerts.emailAdmins'), (v) => setF({ ...f, emailAdmins: v }))}
            <FormField label={t('alerts.extraEmails')} guide={t('alerts.extraEmailsGuide')}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={f.extraEmails}
                  placeholder="noc@congty.vn"
                  onChange={(e) => setF({ ...f, extraEmails: e.target.value })}
                />
              )}
            </FormField>
            <p className="text-sm">
              <span className="text-muted-foreground">{t('alerts.recipientsNow')}: </span>
              {s.recipients.length > 0 ? s.recipients.join(', ') : t('alerts.noRecipients')}
            </p>
          </fieldset>
        </fieldset>
        <Button type="submit" disabled={save.isPending}>
          <BellRing aria-hidden /> {t('common.save')}
        </Button>
      </form>
    </div>
  )
}
