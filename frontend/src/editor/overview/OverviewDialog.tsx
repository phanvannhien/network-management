import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCategories } from '@/modules/sites/sites'
import { useDiagramMutations, useDiagrams } from '../doc/api'
import { overviewView, suggestHubs, useSiteGraph } from './siteGraph'

/**
 * New overview from the inventory (P2-21, ADR-040): the organization or one category; the hub(s) suggested from the
 * links between sites (most peers, a datacenter, a head-office name), changeable; one frame per category.
 */
export function OverviewDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const categories = useCategories(orgId)
  const diagrams = useDiagramMutations(orgId)
  const existing = useDiagrams(orgId)
  const [categoryId, setCategoryId] = useState('')
  const graph = useSiteGraph(orgId, true, categoryId || null)
  const sites = useMemo(() => graph.data?.sites ?? [], [graph.data])
  const [hubs, setHubs] = useState<string[]>([])
  const [byCategory, setByCategory] = useState(true)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Suggest hubs once per scope; later refetches keep what the user picked.
  const [seeded, setSeeded] = useState<string | null>(null)
  useEffect(() => {
    if (!graph.data || seeded === categoryId) return
    setHubs(suggestHubs(graph.data.sites))
    setSeeded(categoryId)
  }, [graph.data, categoryId, seeded])

  const create = async () => {
    if (!graph.data) return
    setBusy(true)
    try {
      const scope = categories.data?.find((c) => c.id === categoryId)?.path
      // The default name takes a number when an overview of that scope exists already.
      const base = t('overview.defaultName', { scope: scope ?? t('overview.wholeOrg') }).slice(
        0,
        110,
      )
      const used = new Set((existing.data ?? []).map((d) => d.name.toLowerCase()))
      let finalName = name.trim() || base
      for (let n = 2; !name.trim() && used.has(finalName.toLowerCase()); n++)
        finalName = `${base} (${n})`
      const created = await diagrams.create.mutateAsync({
        name: finalName.slice(0, 120),
        layer: 'overview',
      })
      if (!created) return
      await diagrams.save.mutateAsync({
        diagramId: created.diagram.id,
        body: {
          version: created.diagram.version,
          view: overviewView(graph.data, hubs, byCategory, undefined, t('overview.noCategory')),
          changes: [],
        },
      })
      void navigate(`/o/${orgId}/diagrams/${created.diagram.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('overview.title')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('overview.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('overview.intro')}</p>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          <FormField label={t('overview.scope')} guide={t('overview.scopeGuide')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t('overview.wholeOrg')}</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('overview.hubs')}</legend>
            <p className="text-xs text-muted-foreground">{t('overview.hubsGuide')}</p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
              {sites.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {graph.isPending ? t('overview.loading') : t('overview.noSites')}
                </p>
              )}
              {[...sites]
                .sort((a, b) => b.peers - a.peers || a.code.localeCompare(b.code))
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={hubs.includes(s.id)}
                      onChange={(e) =>
                        setHubs((h) =>
                          e.target.checked ? [...h, s.id] : h.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <span className="font-mono">{s.localCode}</span>
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t('overview.peers', { count: s.peers })}
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={byCategory}
              onChange={(e) => setByCategory(e.target.checked)}
            />
            {t('overview.byCategory')}
          </label>
          <FormField label={t('overview.name')}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                placeholder={t('overview.defaultName', { scope: t('overview.wholeOrg') })}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || sites.length === 0} onClick={() => void create()}>
            {busy ? t('overview.working') : t('overview.create', { count: sites.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
