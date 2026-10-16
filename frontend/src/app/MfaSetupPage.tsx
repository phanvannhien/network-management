import { useQueryClient } from '@tanstack/react-query'
import { Copy, Download } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CopyButton } from '@/components/CopyButton'
import { FormField } from '@/components/FormField'
import { MfaCodeInput } from '@/components/MfaCodeInput'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { copyText } from '@/lib/clipboard'
import { groupKey } from '@/lib/format'
import { AuthCard, authControl } from './AuthCard'
import { SESSION_QUERY_KEY, useMfaEnable, useMfaSetup, useSession } from './auth'
import { safeNext } from './safeNext'

/** Mandatory step after enabling MFA: codes must be copied/downloaded and acknowledged. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation()
  const [saved, setSaved] = useState(false)
  const text = codes.join('\n') + '\n'
  return (
    <AuthCard title={t('auth.recoveryTitle')} description={t('auth.recoveryBody')}>
      <ul
        className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-muted p-3 font-mono text-tech"
        aria-label={t('auth.recoveryList')}
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => void copyText(text).then((ok) => ok && toast.success(t('common.copied')))}
        >
          <Copy aria-hidden /> {t('auth.recoveryCopy')}
        </Button>
        <a
          className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
          download="ntb-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        >
          <Download aria-hidden /> {t('auth.recoveryDownload')}
        </a>
      </div>
      <label className="flex items-start gap-2">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(!!v)} className="mt-1" />
        <span>{t('auth.recoverySaved')}</span>
      </label>
      <Button className={`w-full ${authControl}`} disabled={!saved} onClick={onDone}>
        {t('auth.continue')}
      </Button>
    </AuthCard>
  )
}

/**
 * TOTP enrollment: QR code (or grouped manual key) → confirm with a code → recovery codes.
 * Mandatory for system admins, organization owners/admins and credential.reveal holders (ADR-019).
 */
export function MfaSetupPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useSession()
  const setup = useMfaSetup()
  const enable = useMfaEnable()
  const [code, setCode] = useState('')

  if (session.isPending) return null
  if (!session.data) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  // Already enrolled and not in the middle of showing freshly issued codes.
  if (session.data.mfa.enabled && !enable.data) return <Navigate to={next} replace />

  if (enable.data) {
    return (
      <RecoveryCodes
        codes={enable.data}
        onDone={() =>
          void queryClient
            .invalidateQueries({ queryKey: SESSION_QUERY_KEY })
            .then(() => navigate(next, { replace: true }))
        }
      />
    )
  }

  const confirm = (c: string) => enable.mutate(c, { onError: () => setCode('') })
  const onConfirm = (e: FormEvent) => {
    e.preventDefault()
    confirm(code)
  }

  return (
    <AuthCard
      title={t('auth.setupTitle')}
      description={session.data.mfa.required ? t('auth.setupRequired') : undefined}
    >
      {!setup.data ? (
        <>
          <p>{t('auth.setupIntro')}</p>
          {setup.isError && (
            <p role="alert" className="text-destructive">
              {setup.error.message}
            </p>
          )}
          <Button
            className={`w-full ${authControl}`}
            disabled={setup.isPending}
            onClick={() => setup.mutate()}
          >
            {setup.isPending ? t('auth.starting') : t('auth.start')}
          </Button>
        </>
      ) : (
        <form onSubmit={onConfirm} className="space-y-4">
          <p className="font-medium">{t('auth.scan')}</p>
          <img
            src={setup.data.qrCode}
            alt={t('auth.qrAlt')}
            className="mx-auto size-44 rounded-md bg-white p-2 ring-1 ring-border"
          />
          <div className="space-y-1">
            <p className="text-label text-muted-foreground">{t('auth.manualKey')}</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5">
              <code className="flex-1 font-mono text-tech break-words" data-testid="mfa-secret">
                {groupKey(setup.data.secret)}
              </code>
              <CopyButton value={setup.data.secret} label={t('auth.copyKey')} />
            </div>
          </div>
          <FormField
            label={t('auth.enterCode')}
            error={enable.isError ? enable.error.message : undefined}
          >
            {(f) => (
              <MfaCodeInput
                {...f}
                autoFocus
                required
                value={code}
                onChange={setCode}
                onComplete={confirm}
                disabled={enable.isPending}
              />
            )}
          </FormField>
          <Button type="submit" disabled={enable.isPending} className={`w-full ${authControl}`}>
            {enable.isPending ? t('auth.verifying') : t('auth.enable')}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
