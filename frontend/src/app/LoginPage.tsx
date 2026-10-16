import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { FormField } from '@/components/FormField'
import { PasswordInput } from '@/components/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthCard, authControl } from './AuthCard'
import { useLogin, useSession } from './auth'
import { safeNext } from './safeNext'

export function LoginPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const session = useSession()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // The route guard on `next` sends the user on to the MFA screens if a second factor is still owed.
  if (session.data) return <Navigate to={next} replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password }, { onSuccess: () => navigate(next, { replace: true }) })
  }

  return (
    <AuthCard title={t('auth.signIn')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label={t('auth.email')}>
          {(f) => (
            <Input
              {...f}
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authControl}
            />
          )}
        </FormField>
        <div className="space-y-1">
          <FormField label={t('auth.password')}>
            {(f) => (
              <PasswordInput
                {...f}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authControl}
              />
            )}
          </FormField>
          <div className="text-right">
            <Link to="/forgot-password" className="text-label text-primary hover:underline">
              {t('auth.forgot')}
            </Link>
          </div>
        </div>
        {login.isError && (
          <p role="alert" className="text-destructive">
            {login.error.message}
          </p>
        )}
        <Button type="submit" disabled={login.isPending} className={`w-full ${authControl}`}>
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthCard>
  )
}
