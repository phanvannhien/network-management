import { Mail, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/auth'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSaveSmtp, useSmtp, useTestSmtp, type SmtpSettings } from '@/modules/alerts/alerts'
import { useHelpTopic } from '@/help/topic'
import { useStepUp } from '@/app/stepUp'

type Security = SmtpSettings['security']
const DEFAULT_PORT: Record<Security, number> = { starttls: 587, tls: 465, none: 25 }

/**
 * System area › outgoing mail (P2-05, ADR-043): one SMTP server for the installation, used by expiry alerts. The
 * stored password is never shown: empty keeps it.
 */
export function AdminSmtpPage() {
  const { t } = useTranslation()
  const session = useSession()
  const smtp = useSmtp(session.data?.user.isSystemAdmin === true)
  useBreadcrumbs([{ label: t('smtp.title') }])
  useHelpTopic('cai-dat-nang-cap')
  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />
  if (!smtp.data) return <Skeleton className="m-4 h-64" />
  return <SmtpForm saved={smtp.data} />
}

function SmtpForm({ saved }: { saved: SmtpSettings }) {
  const { t } = useTranslation()
  const save = useSaveSmtp()
  const test = useTestSmtp()
  const stepUp = useStepUp()
  const [f, setF] = useState(() => {
    const { passwordSet: _p, configured: _c, ...rest } = saved
    return rest
  })
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [to, setTo] = useState('')
  const [result, setResult] = useState<{ sent: boolean; message: string } | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    saveNow()
  }
  const testNow = (): void =>
    test.mutate(to.trim(), {
      onSuccess: (r) => r && setResult(r),
      onError: (err) =>
        stepUp.guard(err, testNow) || setResult({ sent: false, message: err.message }),
    })
  const saveNow = (): void => {
    save.mutate(
      {
        ...f,
        port: Number(f.port) || DEFAULT_PORT[f.security],
        ...(clearPassword ? { password: '' } : password ? { password } : {}),
      },
      {
        onSuccess: () => {
          setPassword('')
          setClearPassword(false)
          toast.success(t('smtp.saved'))
        },
        onError: (err) => stepUp.guard(err, saveNow) || toast.error(err.message),
      },
    )
  }

  return (
    <div className="space-y-3 p-4">
      <PageHeader title={t('smtp.title')} description={t('smtp.intro')} />
      <form
        onSubmit={onSubmit}
        className="max-w-3xl space-y-3 rounded-lg border border-border bg-card p-4"
        aria-label={t('smtp.title')}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            className="sm:col-span-2"
            label={t('smtp.host')}
            guide={t('smtp.hostGuide')}
            help="smtp"
          >
            {(p) => (
              <Input
                {...p}
                value={f.host}
                maxLength={253}
                placeholder="smtp.gmail.com"
                onChange={(e) => set('host', e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('smtp.port')} guide={t('smtp.portGuide')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={65535}
                value={f.port}
                onChange={(e) => set('port', Number(e.target.value))}
              />
            )}
          </FormField>
        </div>
        <FormField label={t('smtp.security')} guide={t(`smtp.securityGuide.${f.security}`)}>
          {(p) => (
            <NativeSelect
              {...p}
              value={f.security}
              onChange={(e) => {
                const s = e.target.value as Security
                // The usual port follows the choice unless someone typed another one.
                setF({
                  ...f,
                  security: s,
                  port: Object.values(DEFAULT_PORT).includes(f.port) ? DEFAULT_PORT[s] : f.port,
                })
              }}
            >
              {(['starttls', 'tls', 'none'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`smtp.securityValues.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('smtp.username')} guide={t('smtp.usernameGuide')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                value={f.username}
                maxLength={320}
                onChange={(e) => set('username', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t('smtp.password')}
            guide={saved.passwordSet ? t('smtp.passwordKept') : t('smtp.passwordGuide')}
          >
            {(p) => (
              <div className="flex gap-2">
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  maxLength={500}
                  disabled={clearPassword}
                  placeholder={saved.passwordSet ? '••••••••' : ''}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {saved.passwordSet && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={clearPassword}
                    onClick={() => setClearPassword(!clearPassword)}
                  >
                    {clearPassword ? t('smtp.keepPassword') : t('smtp.clearPassword')}
                  </Button>
                )}
              </div>
            )}
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('smtp.fromAddress')} guide={t('smtp.fromAddressGuide')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={f.fromAddress}
                maxLength={320}
                placeholder="ntb@congty.vn"
                onChange={(e) => set('fromAddress', e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('smtp.fromName')}>
            {(p) => (
              <Input
                {...p}
                value={f.fromName}
                maxLength={200}
                placeholder="Network Topology Builder"
                onChange={(e) => set('fromName', e.target.value)}
              />
            )}
          </FormField>
        </div>
        <FormField label={t('smtp.publicUrl')} guide={t('smtp.publicUrlGuide')}>
          {(p) => (
            <Input
              {...p}
              type="url"
              value={f.publicUrl}
              maxLength={300}
              placeholder="https://ntb.congty.vn"
              onChange={(e) => set('publicUrl', e.target.value)}
            />
          )}
        </FormField>
        <Button type="submit" disabled={save.isPending}>
          <Mail aria-hidden /> {t('common.save')}
        </Button>
      </form>

      <section
        aria-label={t('smtp.testTitle')}
        className="max-w-3xl space-y-2 rounded-lg border border-border bg-card p-4"
      >
        <h2 className="font-semibold">{t('smtp.testTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('smtp.testGuide')}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setResult(null)
            testNow()
          }}
        >
          <Input
            type="email"
            aria-label={t('smtp.testTo')}
            placeholder={t('smtp.testTo')}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!to.trim() || test.isPending}>
            <Send aria-hidden /> {t('smtp.testSend')}
          </Button>
        </form>
        {result && (
          <p
            role="status"
            className={result.sent ? 'text-sm text-status-up' : 'text-sm text-status-down'}
          >
            {result.sent ? t('smtp.testSent') : t('smtp.testError', { message: result.message })}
          </p>
        )}
      </section>
      {stepUp.prompt}
    </div>
  )
}
