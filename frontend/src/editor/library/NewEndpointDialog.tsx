import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSites } from '@/modules/sites/sites'
import { ENDPOINT_KINDS, type EndpointKind } from './items'

export interface NewEndpointInput {
  kind: EndpointKind
  name: string
  siteId: string
  expectedCount: number | null
}

/**
 * Endpoints drawn on the diagram (ADR-036): one node for the alike endpoints of a place, outside the device list.
 * The minimum here (kind, name, site, how many); the IP range, notes and cabling come in the panel / cable dialog.
 * "Manage each one in the inventory" goes back to creating a device instead.
 */
export function NewEndpointDialog({
  orgId,
  kind: initialKind,
  defaultSiteId,
  takenNames,
  onCreate,
  onAsDevice,
  onClose,
}: {
  orgId: string
  kind: EndpointKind
  defaultSiteId: string | null
  /** Group names already used per site (`siteId|name`, lowercase): a site cannot have two groups of one name. */
  takenNames: ReadonlySet<string>
  onCreate: (input: NewEndpointInput) => void
  onAsDevice: (kind: EndpointKind, siteId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sites = useSites(orgId)
  const [kind, setKind] = useState<EndpointKind>(initialKind)
  const [siteId, setSiteId] = useState(defaultSiteId ?? '')
  const [name, setName] = useState('')
  const [count, setCount] = useState('')
  const [asDevice, setAsDevice] = useState(false)
  const site = sites.data?.find((s) => s.id === siteId)
  const suggested = `${t(`devices.types.${kind}`)}${site ? ` ${site.localCode}` : ''}`
  const value = name.trim() || suggested
  const taken = siteId !== '' && takenNames.has(`${siteId}|${value.toLowerCase()}`)
  const n = count.trim() === '' ? null : Number(count)
  const badCount = n !== null && (!Number.isInteger(n) || n < 1 || n > 100000)
  const canSave = siteId !== '' && (asDevice || (!taken && !badCount && value.length <= 100))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('endpointNew.title')} className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSave) return
            if (asDevice) onAsDevice(kind, siteId)
            else onCreate({ kind, name: value, siteId, expectedCount: n })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('endpointNew.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">{t('endpointNew.body')}</p>
          <FormField label={t('endpointNew.kind')} required>
            {(p) => (
              <NativeSelect
                {...p}
                value={kind}
                onChange={(e) => setKind(e.target.value as EndpointKind)}
              >
                {ENDPOINT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`devices.types.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label={t('devices.site')} guide={t('library.siteGuide')} help="site" required>
            {(p) => (
              <NativeSelect
                {...p}
                required
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">{t('library.chooseSite')}</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {!asDevice && (
            <>
              <FormField
                label={t('endpointNew.name')}
                hint={
                  taken ? t('endpointNew.taken') : t('endpointNew.nameHint', { name: suggested })
                }
                error={taken ? t('endpointNew.taken') : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={100}
                    placeholder={suggested}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label={t('endpointNew.count')}
                guide={t('endpointNew.countGuide')}
                error={badCount ? t('endpointNew.badCount') : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    placeholder="24"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                )}
              </FormField>
            </>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={asDevice}
              onCheckedChange={(v) => setAsDevice(v === true)}
              className="mt-0.5"
            />
            <span>
              {t('endpointNew.asDevice')}
              <span className="block text-xs text-muted-foreground">
                {t('endpointNew.asDeviceGuide')}
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {asDevice ? t('endpointNew.next') : t('endpointNew.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
