import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { describeGroup } from '@/editor/workspace/portGuess'
import { templateFromCatalog, useCatalog, type DeviceTemplate } from './devices'
import { norm } from './import/parse'

/**
 * System templates (ADR-035): the device models shipped with the software, read only. A device whose model matches
 * one gets its ports from it without any copy; "Copy to edit" makes an own template from it when something differs.
 */
export function SystemTemplates({
  orgId,
  canEdit,
  onCopied,
}: {
  orgId: string
  canEdit: boolean
  onCopied: (t: DeviceTemplate) => void
}) {
  const { t } = useTranslation()
  const catalog = useCatalog(orgId)
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
      .slice(0, 200)
  }, [catalog.data, q, vendor])

  const copy = async (id: string) => {
    setBusy(true)
    try {
      onCopied(await templateFromCatalog(orgId, id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (catalog.isPending) return <Skeleton className="h-24" />
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t('templates.systemGuide', { count: catalog.data?.length ?? 0 })}
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
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {shown.map((m) => (
          <li key={m.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-1 text-left"
                aria-expanded={open === m.id}
                onClick={() => setOpen(open === m.id ? null : m.id)}
              >
                {open === m.id ? (
                  <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="font-medium">
                    {m.vendor} {m.model}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`devices.types.${m.type}`)} ·{' '}
                    {t('templates.portCount', { count: m.portCount })}
                    {m.partNumbers.length > 0 && ` · ${m.partNumbers.join(', ')}`}
                    {!m.verified && (
                      <span className="ml-1 text-status-warning">
                        · {t('deviceImport.catalogUnverified')}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {canEdit && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void copy(m.id)}>
                  <Copy aria-hidden /> {t('templates.copyToEdit')}
                </Button>
              )}
            </div>
            {open === m.id && (
              <div className="mt-1 ml-5 space-y-0.5 text-sm">
                <ul className="list-inside list-disc font-mono text-xs">
                  {m.ports.map((g, i) => (
                    <li key={i}>{describeGroup(g)}</li>
                  ))}
                </ul>
                {m.notes && <p className="text-muted-foreground">{m.notes}</p>}
                {m.source && (
                  <a
                    className="text-xs text-primary underline"
                    href={m.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('templates.source')}
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">{t('catalog.none')}</li>
        )}
      </ul>
    </div>
  )
}
