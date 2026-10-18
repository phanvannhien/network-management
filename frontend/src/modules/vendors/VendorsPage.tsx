import { Building2, FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useOrganization } from '@/app/orgs'
import { formatDate } from '@/lib/format'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'
import { ContractDialog } from './ContractDialog'
import { VendorDialog } from './VendorDialogs'
import { VENDOR_KINDS, useContracts, useVendors } from './vendors'

/**
 * Vendors & contracts (P2-04, SRS §8): manufacturers, suppliers, ISPs and maintenance companies with their support
 * channels, and the contracts that cover devices and WAN links — each with its own end date.
 */
export function VendorsPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'contracts' ? 'contracts' : 'vendors'
  const org = useOrganization(orgId)
  const role = org.data?.membership.role
  const canEdit = role === 'owner' || role === 'admin' || role === 'editor'
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [within, setWithin] = useState(params.get('within') ?? '')
  const [adding, setAdding] = useState<'vendor' | 'contract' | null>(null)
  useBreadcrumbs([{ label: t('vendors.title') }])
  const vendors = useVendors(orgId, q, kind, tab === 'vendors')
  const contracts = useContracts(
    orgId,
    { q, endsWithinDays: within ? Number(within) : undefined },
    tab === 'contracts',
  )

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('vendors.title')}
        description={t('vendors.intro')}
        actions={
          canEdit && (
            <>
              <Button
                variant={tab === 'vendors' ? 'default' : 'outline'}
                onClick={() => setAdding('vendor')}
              >
                <Plus aria-hidden /> {t('vendors.add')}
              </Button>
              <Button
                variant={tab === 'contracts' ? 'default' : 'outline'}
                onClick={() => setAdding('contract')}
              >
                <Plus aria-hidden /> {t('contracts.add')}
              </Button>
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams(v === 'contracts' ? { tab: 'contracts' } : {}, { replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="vendors">
            <Building2 aria-hidden /> {t('vendors.tab')}
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileText aria-hidden /> {t('contracts.tab')}
          </TabsTrigger>
        </TabsList>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            className="max-w-sm"
            aria-label={t('vendors.search')}
            placeholder={t('vendors.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {tab === 'vendors' ? (
            <div className="w-48">
              <NativeSelect
                aria-label={t('vendors.kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">{t('vendors.allKinds')}</option>
                {VENDOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`vendors.kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="w-56">
              <NativeSelect
                aria-label={t('contracts.endingFilter')}
                value={within}
                onChange={(e) => setWithin(e.target.value)}
              >
                <option value="">{t('contracts.allEnds')}</option>
                <option value="30">{t('contracts.endsWithin', { count: 30 })}</option>
                <option value="90">{t('contracts.endsWithin', { count: 90 })}</option>
                <option value="0">{t('contracts.ended')}</option>
              </NativeSelect>
            </div>
          )}
        </div>
        <TabsContent value="vendors" className="pt-3">
          {vendors.isPending ? (
            <Skeleton className="h-32" />
          ) : (vendors.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('vendors.none')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('vendors.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('vendors.kind')}</th>
                    <th className="px-3 py-2 font-medium">{t('vendors.supportPhone')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('vendors.contacts')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('contracts.tab')}</th>
                    <th className="px-3 py-2 font-medium">{t('vendors.nextEnd')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(vendors.data ?? []).map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to={`/o/${orgId}/vendors/${v.id}`}
                          className="font-medium hover:underline"
                        >
                          {v.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{t(`vendors.kinds.${v.kind}`)}</td>
                      <td className="px-3 py-2">
                        {v.supportPhone ? (
                          <a href={`tel:${v.supportPhone}`} className="hover:underline">
                            {v.supportPhone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-numeric className="px-3 py-2 text-right">
                        {v.contactCount}
                      </td>
                      <td data-numeric className="px-3 py-2 text-right">
                        {v.contractCount}
                      </td>
                      <td className="px-3 py-2">{v.nextEnd ? formatDate(v.nextEnd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="contracts" className="pt-3">
          {contracts.isPending ? (
            <Skeleton className="h-32" />
          ) : (contracts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contracts.none')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('contracts.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('contracts.vendor')}</th>
                    <th className="px-3 py-2 font-medium">{t('contracts.kind')}</th>
                    <th className="px-3 py-2 font-medium">{t('contracts.endDate')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('contracts.covers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(contracts.data ?? []).map((k) => (
                    <tr key={k.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to={`/o/${orgId}/contracts/${k.id}`}
                          className="font-medium hover:underline"
                        >
                          {k.name}
                        </Link>
                        {k.number && (
                          <span className="ml-1 text-muted-foreground">({k.number})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{k.vendorName}</td>
                      <td className="px-3 py-2">{t(`contracts.kinds.${k.kind}`)}</td>
                      <td className="px-3 py-2">
                        <WarrantyText date={k.endDate} />
                      </td>
                      <td data-numeric className="px-3 py-2 text-right">
                        {t('contracts.coversCount', { devices: k.deviceCount, links: k.linkCount })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {adding === 'vendor' && (
        <VendorDialog
          orgId={orgId}
          onClose={() => setAdding(null)}
          onSaved={(v) => void navigate(`/o/${orgId}/vendors/${v.id}`)}
        />
      )}
      {adding === 'contract' && (
        <ContractDialog
          orgId={orgId}
          onClose={() => setAdding(null)}
          onSaved={(d) => void navigate(`/o/${orgId}/contracts/${d.contract.id}`)}
        />
      )}
    </div>
  )
}
