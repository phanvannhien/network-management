import { useQueryClient } from '@tanstack/react-query'
import { FilePlus2, Network, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchDevicePage } from '@/modules/inventory/devices'
import { importedView } from '@/modules/inventory/import/layout'
import { useDiagramMutations, useDiagrams } from '../doc/api'
import type { SiteCard } from './siteGraph'

// Drilling down from an overview (P2-21): a site with several detail diagrams offers them; with none, an empty one or
// one generated from the inventory (the site's devices in its frame — cables appear by themselves, ADR-015).

/** Order inside a generated detail diagram: edge, core, access, the rest. */
const TIER: Record<string, string> = {
  provider_cloud: '0',
  modem: '1',
  ont: '1',
  firewall: '2',
  router: '2',
  vpn_gateway: '2',
  l3_switch: '3',
  l2_switch: '4',
  poe_switch: '4',
  access_point: '5',
}

export function SiteDrillDialog({
  orgId,
  site,
  from,
  onClose,
}: {
  orgId: string
  site: SiteCard
  /** The overview we come from (breadcrumb back). */
  from: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const diagrams = useDiagramMutations(orgId)
  const existing = useDiagrams(orgId)
  const [busy, setBusy] = useState(false)
  const open = (id: string) =>
    void navigate(`/o/${orgId}/diagrams/${id}?from=${from}&focus=${site.id}`)

  const create = async (generate: boolean) => {
    setBusy(true)
    let createdId = ''
    try {
      // A second detail diagram of the site takes a number (names are unique in the organization).
      const base = t('overview.detailName', { code: site.localCode, name: site.name }).slice(0, 110)
      const used = new Set((existing.data ?? []).map((d) => d.name.toLowerCase()))
      let name = base
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`
      const created = await diagrams.create.mutateAsync({ name, layer: 'physical' })
      if (!created) return
      createdId = created.diagram.id
      let view = {
        nodes: [] as ReturnType<typeof importedView>['nodes'],
        edges: [],
        annotations: [
          {
            id: crypto.randomUUID(),
            kind: 'zone' as const,
            x: 0,
            y: 0,
            width: 640,
            height: 400,
            siteId: site.id,
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      } as ReturnType<typeof importedView>
      if (generate) {
        const devices: { id: string; siteId: string; group: string }[] = []
        for (let page = 0; ; page++) {
          const r = await fetchDevicePage(orgId, {
            q: '',
            facets: { site: [site.id] },
            categoryId: null,
            sort: null,
            pageIndex: page,
            pageSize: 200,
          })
          for (const d of r.devices)
            if (d.lifecycle !== 'retired')
              devices.push({
                id: d.id,
                siteId: site.id,
                group: `${TIER[d.type] ?? '6'}${d.type}${d.hostname}`,
              })
          if (r.devices.length === 0 || (page + 1) * 200 >= r.total) break
        }
        view = importedView(devices, [site.id])
        // The site's endpoint groups in a row under the frame.
        const g = await api.GET('/orgs/{orgId}/endpoint-groups', {
          params: { path: { orgId }, query: { siteId: site.id } },
        })
        const frame = view.annotations[0]
        const y = frame ? frame.y + (frame.height ?? 0) + 60 : 0
        ;(g.data?.groups ?? [])
          .filter((x) => x.siteId === site.id)
          .forEach((x, i) =>
            view.nodes.push({
              id: crypto.randomUUID(),
              refKind: 'endpoint_group',
              refId: x.id,
              x: i * 192,
              y,
            }),
          )
        if (view.annotations.length === 0)
          view.annotations.push({
            id: crypto.randomUUID(),
            kind: 'zone',
            x: 0,
            y: 0,
            width: 640,
            height: 400,
            siteId: site.id,
          })
      }
      await diagrams.save.mutateAsync({
        diagramId: created.diagram.id,
        body: { version: created.diagram.version, view, changes: [] },
      })
      void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'site-graph'] })
      open(created.diagram.id)
    } catch (err) {
      // Never leave an empty diagram behind a failed generation.
      if (createdId) await diagrams.remove.mutateAsync(createdId).catch(() => undefined)
      toast.error(err instanceof Error ? err.message : t('errors.save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-label={t('overview.drillTitle', { code: site.localCode })}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            {site.localCode} · {site.name}
          </DialogTitle>
        </DialogHeader>
        {site.diagrams.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('overview.pickDiagram')}</p>
            {site.diagrams.map((d) => (
              <Button
                key={d.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => open(d.id)}
              >
                <Network aria-hidden /> {d.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('overview.noDiagram')}</p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" disabled={busy} onClick={() => void create(false)}>
            <FilePlus2 aria-hidden /> {t('overview.createEmpty')}
          </Button>
          <Button disabled={busy} onClick={() => void create(true)}>
            <Wand2 aria-hidden /> {t('overview.generateDetail')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
