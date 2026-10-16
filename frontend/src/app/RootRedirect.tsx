import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { buttonVariants } from '@/components/ui/button'
import { useSession } from './auth'
import { useMyOrganizations } from './orgs'

/** "/" → the organization used last (if still a member) or the first one; explains when there is none. */
export function RootRedirect() {
  const { t } = useTranslation()
  const session = useSession()
  const orgs = useMyOrganizations()

  if (orgs.isPending) return <p className="p-6 text-muted-foreground">{t('common.loading')}</p>
  if (orgs.isError) {
    return (
      <p role="alert" className="p-6 text-destructive">
        {orgs.error.message}
      </p>
    )
  }
  const active = session.data?.activeOrganizationId
  const target = orgs.data.find((o) => o.id === active) ?? orgs.data[0]
  if (target) return <Navigate to={`/o/${target.id}`} replace />

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <EmptyState
        icon={<Building2 />}
        titleAs="h1"
        title={t('noOrg.title')}
        description={t('noOrg.body')}
        action={
          session.data?.user.isSystemAdmin && (
            <Link to="/admin/organizations" className={buttonVariants({ variant: 'outline' })}>
              {t('noOrg.admin')}
            </Link>
          )
        }
      />
    </main>
  )
}
