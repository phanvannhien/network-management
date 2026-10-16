import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useOrganization } from '@/app/orgs'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PartnerFormDialog } from './PartnerFormDialog'
import { PartnersTable } from './PartnersTable'
import { SiteFormDialog } from './SiteFormDialog'
import { SitesTable } from './SitesTable'
import { useSites } from './sites'
import { UnitFormDialog } from './UnitFormDialog'
import { UnitsTable } from './UnitsTable'

const TABS = ['partners', 'units', 'sites'] as const
type Tab = (typeof TABS)[number]

/**
 * "Đơn vị & Sites" (SRS §2, ADR-031): the organization's partners, their business units and all sites.
 * Sites are filtered by the member's site scope on the server.
 */
export function SiteListPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const org = useOrganization(orgId)
  const [creating, setCreating] = useState<Tab | null>(null)
  const tab: Tab = TABS.find((x) => x === params.get('tab')) ?? 'partners'
  const sharedCount = useSites(orgId).data?.filter((s) => s.businessUnitId === null).length ?? 0
  useBreadcrumbs([{ label: t('units.hub') }])

  const role = org.data?.membership.role
  const canAdmin = role === 'owner' || role === 'admin'
  const canEdit = canAdmin || role === 'editor'

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={org.data ? t('units.hubOf', { org: org.data.organization.name }) : t('units.hub')}
        actions={
          <>
            {canAdmin && (
              <>
                <Button
                  variant={tab === 'partners' ? 'default' : 'outline'}
                  onClick={() => setCreating('partners')}
                >
                  <Plus aria-hidden /> {t('partners.add')}
                </Button>
                <Button
                  variant={tab === 'units' ? 'default' : 'outline'}
                  onClick={() => setCreating('units')}
                >
                  <Plus aria-hidden /> {t('units.add')}
                </Button>
              </>
            )}
            {canEdit && (
              <Button
                variant={tab === 'sites' ? 'default' : 'outline'}
                onClick={() => setCreating('sites')}
              >
                <Plus aria-hidden /> {t('sites.add')}
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}>
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="partners">{t('units.tabPartners')}</TabsTrigger>
          <TabsTrigger value="units">{t('units.tabUnits')}</TabsTrigger>
          <TabsTrigger value="sites">{t('units.tabSites')}</TabsTrigger>
        </TabsList>
        <TabsContent value="partners" className="space-y-2 pt-3">
          <PartnersTable orgId={orgId} canAdmin={canAdmin} onAdd={() => setCreating('partners')} />
          <p className="text-muted-foreground">
            <Link
              to={`/o/${orgId}/sites?tab=sites`}
              className="hover:text-foreground hover:underline"
            >
              {t('units.sharedShort')}: {sharedCount} {t('units.sites').toLowerCase()}
            </Link>{' '}
            — {t('units.sharedHint')}
          </p>
        </TabsContent>
        <TabsContent value="units" className="pt-3">
          <UnitsTable orgId={orgId} canAdmin={canAdmin} onAdd={() => setCreating('units')} />
        </TabsContent>
        <TabsContent value="sites" className="pt-3">
          <SitesTable orgId={orgId} canEdit={canEdit} onAdd={() => setCreating('sites')} />
        </TabsContent>
      </Tabs>
      {creating === 'partners' && (
        <PartnerFormDialog
          orgId={orgId}
          onClose={() => setCreating(null)}
          onSaved={(p) => navigate(`/o/${orgId}/partners/${p.id}`)}
        />
      )}
      {creating === 'units' && (
        <UnitFormDialog
          orgId={orgId}
          onClose={() => setCreating(null)}
          onSaved={(u) => navigate(`/o/${orgId}/units/${u.id}`)}
        />
      )}
      {creating === 'sites' && (
        <SiteFormDialog
          orgId={orgId}
          open
          onClose={() => setCreating(null)}
          onSaved={(s) => navigate(`/o/${orgId}/sites/${s.id}`)}
        />
      )}
    </div>
  )
}
