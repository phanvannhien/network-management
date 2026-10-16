import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { AuthCard, authControl } from './AuthCard'

/** No SMTP yet (P2-05): explains that an administrator issues a one-time reset link. */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.forgotTitle')}>
      <p>{t('auth.forgotBody')}</p>
      <Link
        to="/login"
        className={buttonVariants({ variant: 'outline', className: `w-full ${authControl}` })}
      >
        {t('auth.forgotBack')}
      </Link>
    </AuthCard>
  )
}
