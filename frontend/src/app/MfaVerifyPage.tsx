import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { FormField } from '@/components/FormField'
import { MfaCodeInput } from '@/components/MfaCodeInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthCard, authControl } from './AuthCard'
import { mfaStep, useLogout, useMfaVerify, useSession } from './auth'
import { safeNext } from './safeNext'

/** Second sign-in step: TOTP code (auto-submits at 6 digits) or a one-time recovery code. */
export function MfaVerifyPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const session = useSession()
  const verify = useMfaVerify()
  const logout = useLogout()
  const [useRecovery, setUseRecovery] = useState(false)
  const [value, setValue] = useState('')

  if (session.isPending) return null
  if (!session.data) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  if (mfaStep(session.data) !== 'verify' && !verify.isSuccess) return <Navigate to={next} replace />

  const submit = (v: string) =>
    verify.mutate(useRecovery ? { recoveryCode: v } : { code: v }, {
      onSuccess: () => navigate(next, { replace: true }),
      onError: () => !useRecovery && setValue(''),
    })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(value)
  }

  return (
    <AuthCard
      title={t('auth.mfaTitle')}
      footer={
        <div className="flex w-full max-w-sm justify-between text-label">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setUseRecovery(!useRecovery)
              setValue('')
              verify.reset()
            }}
          >
            {useRecovery ? t('auth.useApp') : t('auth.useRecovery')}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => logout.mutate()}
          >
            {t('auth.signOut')}
          </button>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          key={useRecovery ? 'recovery' : 'totp'}
          label={useRecovery ? t('auth.recoveryCode') : t('auth.mfaCode')}
          error={verify.isError ? verify.error.message : undefined}
        >
          {(f) =>
            useRecovery ? (
              <Input
                {...f}
                autoFocus
                required
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`font-mono ${authControl}`}
              />
            ) : (
              <MfaCodeInput
                {...f}
                autoFocus
                required
                value={value}
                onChange={setValue}
                onComplete={submit}
                disabled={verify.isPending}
              />
            )
          }
        </FormField>
        <Button type="submit" disabled={verify.isPending} className={`w-full ${authControl}`}>
          {verify.isPending ? t('auth.verifying') : t('auth.verify')}
        </Button>
      </form>
    </AuthCard>
  )
}
