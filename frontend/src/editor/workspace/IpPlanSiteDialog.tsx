import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSites } from '@/modules/sites/sites'

/** Which site's IP plan to place (P2-09); the sites of the devices on the page come first, the most used selected. */
export function IpPlanSiteDialog({
  orgId,
  suggested,
  onPick,
  onClose,
}: {
  orgId: string
  /** Site ids of the devices on the page (with repeats). */
  suggested: string[]
  onPick: (siteId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sites = useSites(orgId)
  const count = new Map<string, number>()
  for (const s of suggested) count.set(s, (count.get(s) ?? 0) + 1)
  const ordered = [...(sites.data ?? [])].sort(
    (a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.code.localeCompare(b.code),
  )
  const [siteId, setSiteId] = useState('')
  const value = siteId || ordered[0]?.id || ''
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ipPlan.add')}</DialogTitle>
          <DialogDescription>{t('ipPlan.hint')}</DialogDescription>
        </DialogHeader>
        <FormField label={t('ipam.site')} required>
          {(p) => (
            <NativeSelect {...p} value={value} onChange={(e) => setSiteId(e.target.value)}>
              {ordered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!value} onClick={() => onPick(value)}>
            {t('ipPlan.place')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
