import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { FormField } from '@/components/FormField'
import { PasswordInput } from '@/components/PasswordInput'
import { buttonVariants, Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '../api/client'
import { AuthCard, authControl } from './AuthCard'

/** Public page for one-time links: accept an invitation or reset a password (P1-04). */
export function AcceptInvitePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const info = useQuery({
    queryKey: ['account-token', token],
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/account-tokens/{token}', { params: { path: { token } } })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, 'Link không hợp lệ'))
    },
  })
  const accept = useMutation({
    mutationFn: async () => {
      const r = await api.POST('/account-tokens/{token}', {
        params: { path: { token } },
        body: { displayName, password },
      })
      if (r.response.status === 204) return
      throw new Error(errorMessage(r.error, r.response.status, 'Không đặt được mật khẩu'))
    },
  })

  if (info.isPending) return null
  if (info.isError) {
    return (
      <AuthCard title={t('auth.linkInvalid')}>
        <p role="alert" className="text-destructive">
          {info.error.message}
        </p>
        <p className="text-muted-foreground">{t('auth.linkInvalidHint')}</p>
      </AuthCard>
    )
  }
  const isInvite = info.data.purpose === 'invite'
  if (accept.isSuccess) {
    return (
      <AuthCard title={t('auth.done')}>
        <p>{t('auth.doneBody', { email: info.data.email })}</p>
        <Link to="/login" className={buttonVariants({ className: `w-full ${authControl}` })}>
          {t('auth.signIn')}
        </Link>
      </AuthCard>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setMismatch(password !== confirm)
    if (password === confirm) accept.mutate()
  }

  return (
    <AuthCard
      title={isInvite ? t('auth.inviteTitle') : t('auth.resetTitle')}
      description={
        <>
          <span className="block">{info.data.email}</span>
          {isInvite && info.data.organizations.length > 0 && (
            <span className="block">
              {t('auth.organizations', { names: info.data.organizations.join(', ') })}
            </span>
          )}
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {isInvite && (
          <FormField label={t('auth.displayName')} required>
            {(f) => (
              <Input
                {...f}
                required
                maxLength={100}
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={authControl}
              />
            )}
          </FormField>
        )}
        <FormField label={t('auth.newPassword')} hint={t('auth.newPasswordHint')} required>
          {(f) => (
            <PasswordInput
              {...f}
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authControl}
            />
          )}
        </FormField>
        <FormField
          label={t('auth.confirmPassword')}
          required
          error={mismatch ? t('auth.mismatch') : accept.isError ? accept.error.message : undefined}
        >
          {(f) => (
            <PasswordInput
              {...f}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authControl}
            />
          )}
        </FormField>
        <Button type="submit" disabled={accept.isPending} className={`w-full ${authControl}`}>
          {isInvite ? t('auth.activate') : t('auth.setPassword')}
        </Button>
      </form>
    </AuthCard>
  )
}
