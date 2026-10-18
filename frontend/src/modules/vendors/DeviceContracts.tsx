import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'
import { ContractDialog } from './ContractDialog'
import { SupportBox } from './SupportBox'
import { useContracts, useSetSupplier, useVendors } from './vendors'

/**
 * Device › contracts & warranty (P2-04, SRS §8 "from a device, the hotline and contracts at once"): where it was
 * bought, every contract covering it with the vendor's support channels.
 */
export function DeviceContracts({
  orgId,
  deviceId,
  hostname,
  supplierId,
  canEdit,
}: {
  orgId: string
  deviceId: string
  hostname: string
  supplierId: string | null
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const vendors = useVendors(orgId)
  const contracts = useContracts(orgId, { deviceId })
  const setSupplier = useSetSupplier(orgId, deviceId)
  const [adding, setAdding] = useState(false)
  const supplier = vendors.data?.find((v) => v.id === supplierId)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <FormField label={t('contracts.supplier')} guide={t('contracts.supplierGuide')}>
            {(p) => (
              <NativeSelect
                {...p}
                disabled={!canEdit || setSupplier.isPending}
                value={supplierId ?? ''}
                onChange={(e) =>
                  setSupplier.mutate(e.target.value || null, {
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                <option value="">{t('contracts.noSupplier')}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {supplier && (
            <SupportBox
              phone={supplier.supportPhone}
              email={supplier.supportEmail}
              portal={supplier.supportPortal}
            />
          )}
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('contracts.ofDevice')}</h3>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> {t('contracts.addForDevice')}
              </Button>
            )}
          </div>
          {(contracts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contracts.noneForDevice')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {(contracts.data ?? []).map((k) => (
                <li key={k.id} className="grid gap-2 py-2 sm:grid-cols-2">
                  <div className="text-sm">
                    <Link
                      to={`/o/${orgId}/contracts/${k.id}`}
                      className="font-medium hover:underline"
                    >
                      {k.name}
                    </Link>
                    <p className="text-muted-foreground">
                      {t(`contracts.kinds.${k.kind}`)} · {k.vendorName}
                    </p>
                    <p>
                      {t('contracts.endDate')}: <WarrantyText date={k.endDate} />
                    </p>
                  </div>
                  <SupportBox
                    phone={k.supportPhone}
                    email={k.supportEmail}
                    portal={k.supportPortal}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {adding && (
        <ContractDialog
          orgId={orgId}
          initialDevices={[{ id: deviceId, hostname }]}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
