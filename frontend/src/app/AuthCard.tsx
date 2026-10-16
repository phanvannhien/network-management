import { Network } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvBadge } from '@/components/EnvBadge'
import { useHealth } from './health'

/**
 * Centered card for sign-in, MFA, activation and password pages (DESIGN.md §8b): product name +
 * version, environment badge outside production, 14px/22px form text.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useTranslation()
  const version = useHealth().data?.version
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-form text-foreground">
      <div className="flex items-center gap-2">
        <Network aria-hidden className="size-6 text-primary" strokeWidth={2} />
        <span className="text-base font-semibold">{t('common.product')}</span>
        <EnvBadge />
      </div>
      <section
        className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6"
        aria-labelledby="auth-card-title"
      >
        <div className="space-y-1">
          <h1 id="auth-card-title" className="text-title font-semibold">
            {title}
          </h1>
          {description && <div className="text-muted-foreground">{description}</div>}
        </div>
        {children}
      </section>
      {footer}
      <p className="text-label text-muted-foreground" data-numeric>
        {version ? t('common.version', { version }) : ' '}
      </p>
    </main>
  )
}

/** Full-width primary button / input sizes used on the auth pages. */
export const authControl = 'h-9 text-form'
