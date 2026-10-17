import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { templateFromCatalog, useCatalog } from './devices'
import { norm } from './import/parse'

/**
 * Pick models from the built-in device catalog (ADR-035) and copy them into the organization's templates. A model the
 * organization already has a template for answers with that template (no duplicate).
 */
export function CatalogDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const catalog = useCatalog(orgId)
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const vendors = useMemo(
    () => [...new Set((catalog.data ?? []).map((m) => m.vendor))],
    [catalog.data],
  )
  const shown = useMemo(() => {
    // Every word must appear somewhere ("omada sg2210", "cisco 1300 24p").
    const words = q.split(/\s+/).map(norm).filter(Boolean)
    return (catalog.data ?? [])
      .filter((m) => !vendor || m.vendor === vendor)
      .filter((m) => {
        const hay = [m.model, m.family, m.vendor, ...m.partNumbers, ...m.aliases]
          .map(norm)
          .join(' ')
        return words.every((w) => hay.includes(w))
      })
      .slice(0, 100)
  }, [catalog.data, q, vendor])

  const add = async (id: string) => {
    setBusy(id)
    try {
      const tpl = await templateFromCatalog(orgId, id)
      toast.success(t('catalog.added', { name: tpl.name }))
      void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'device-templates'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('catalog.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('catalog.guide', { count: catalog.data?.length ?? 0 })}
        </p>
        <div className="flex gap-2">
          <Input
            aria-label={t('catalog.search')}
            placeholder={t('catalog.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="w-44 shrink-0">
            <NativeSelect
              aria-label={t('catalog.vendor')}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            >
              <option value="">{t('catalog.allVendors')}</option>
              {vendors.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {shown.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {m.vendor} {m.model}
                </span>{' '}
                <span className="text-muted-foreground">
                  · {t(`devices.types.${m.type}`)} ·{' '}
                  {t('addPorts.portCount', { count: m.portCount })}
                  {m.partNumbers.length > 0 && ` · ${m.partNumbers.join(', ')}`}
                </span>
                {!m.verified && (
                  <span className="block text-xs text-status-warning">
                    {t('deviceImport.catalogUnverified')}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void add(m.id)}
              >
                {t('catalog.add')}
              </Button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('catalog.none')}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
