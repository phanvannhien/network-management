import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { buttonVariants } from '@/components/ui/button'

/** 404 (also used for "no access", which the API reports as 404 — ADR-023). */
export function NotFoundPage({ inShell = false }: { inShell?: boolean }) {
  const { t } = useTranslation()
  const body = (
    <EmptyState
      icon={<FileQuestion />}
      titleAs="h1"
      title={t('notFound.title')}
      description={t('notFound.body')}
      action={
        <Link to="/" className={buttonVariants({ variant: 'outline' })}>
          {t('notFound.home')}
        </Link>
      }
    />
  )
  if (inShell) return <div className="p-4">{body}</div>
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
      <p className="mb-2 font-mono text-4xl font-medium text-muted-foreground" aria-hidden>
        404
      </p>
      {body}
    </main>
  )
}
