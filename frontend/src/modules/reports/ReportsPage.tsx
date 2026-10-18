import { Boxes, Cable, Download, Hash, Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api, csrfParam } from '@/api/client'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fileNameOf } from '@/editor/workspace/exportImage'
import { useInScope, useScope } from '@/modules/sites/access'
import { useSites } from '@/modules/sites/sites'
import {
  boqSheets,
  downloadWorkbook,
  ipPlanSheets,
  portMapSheets,
  vlanSheets,
  type SheetData,
} from './excel'
import {
  useBoqReport,
  useIpPlanReport,
  usePortMapReport,
  useVlanReport,
  type ReportScope,
} from './reports'

/** Rows shown on screen per sheet; the file has them all. */
const PREVIEW_ROWS = 100

const TABS = ['ipPlan', 'vlans', 'portMap', 'boq'] as const
type Tab = (typeof TABS)[number]

const EXPORT_KIND = {
  ipPlan: 'ipplan_xlsx',
  vlans: 'vlans_xlsx',
  portMap: 'portmap_xlsx',
  boq: 'boq_xlsx',
} as const

/** A sheet as it will be in the file (header row first), cut to PREVIEW_ROWS. */
function SheetPreview({ sheet, title }: { sheet: SheetData; title?: string }) {
  const { t } = useTranslation()
  const [head, ...body] = sheet.rows
  const shown = body.slice(0, PREVIEW_ROWS)
  return (
    <div className="space-y-1">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
            <tr>
              {(head ?? []).map((h, i) => (
                <th key={i} className="px-2 py-1 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-border align-top">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-0.5 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > PREVIEW_ROWS && (
        <p className="text-xs text-muted-foreground">
          {t('reports.preview', { shown: PREVIEW_ROWS, total: body.length })}
        </p>
      )}
    </div>
  )
}

/**
 * Reports (P2-11, SRS §12): IP plan, VLANs, port map and BOQ of the topbar scope (or one site), on screen and as
 * Excel. Any member may read them; every download is recorded in the audit log.
 */
export function ReportsPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.find((x) => x === params.get('tab')) ?? 'ipPlan'
  const siteId = params.get('site') ?? ''
  const { categoryId } = useScope(orgId)
  const inScope = useInScope(orgId)
  const sites = (useSites(orgId).data ?? []).filter((s) => inScope(s.categoryId))
  const scope: ReportScope = { categoryId, siteId }
  const [busy, setBusy] = useState(false)
  useBreadcrumbs([{ label: t('reports.title') }])

  const ipPlan = useIpPlanReport(orgId, scope, tab === 'ipPlan')
  const vlans = useVlanReport(orgId, scope, tab === 'vlans')
  const portMap = usePortMapReport(orgId, scope, tab === 'portMap')
  const boq = useBoqReport(orgId, scope, tab === 'boq')
  const current = { ipPlan, vlans, portMap, boq }[tab]
  const sheets: SheetData[] | null = (() => {
    switch (tab) {
      case 'ipPlan':
        return ipPlan.data ? ipPlanSheets(ipPlan.data, t) : null
      case 'vlans':
        return vlans.data ? vlanSheets(vlans.data, t) : null
      case 'portMap':
        return portMap.data ? portMapSheets(portMap.data, t) : null
      case 'boq':
        return boq.data ? boqSheets(boq.data, t) : null
    }
  })()
  // Records in the report (subnets, VLANs, ports, BOQ lines): what the audit entry counts.
  const rowCount =
    {
      ipPlan: ipPlan.data?.length,
      vlans: vlans.data?.length,
      portMap: portMap.data?.reduce((n, d) => n + d.ports.length, 0),
      boq: boq.data?.length,
    }[tab] ?? 0
  const empty = sheets !== null && (sheets.length === 0 || rowCount === 0)

  const set = (next: { tab?: Tab; site?: string }) => {
    const p = new URLSearchParams(params)
    const nt = next.tab ?? tab
    const ns = next.site ?? siteId
    if (nt === 'ipPlan') p.delete('tab')
    else p.set('tab', nt)
    if (ns) p.set('site', ns)
    else p.delete('site')
    setParams(p, { replace: true })
  }

  const download = async () => {
    if (!sheets) return
    setBusy(true)
    try {
      const site = sites.find((s) => s.id === siteId)
      downloadWorkbook(
        sheets,
        fileNameOf(`${t(`reports.tabs.${tab}`)} ${site?.code ?? ''}`, 'xlsx'),
      )
      await api.POST('/orgs/{orgId}/export-events', {
        params: { ...csrfParam, path: { orgId } },
        body: { kind: EXPORT_KIND[tab], count: rowCount },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.loadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const icons = { ipPlan: Hash, vlans: Layers, portMap: Cable, boq: Boxes }
  return (
    <div className="space-y-3 p-4">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <Tabs value={tab} onValueChange={(v) => set({ tab: v as Tab })}>
        <TabsList>
          {TABS.map((x) => {
            const Icon = icons[x]
            return (
              <TabsTrigger key={x} value={x}>
                <Icon aria-hidden /> {t(`reports.tabs.${x}`)}
              </TabsTrigger>
            )
          })}
        </TabsList>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-64">
            <NativeSelect
              aria-label={t('reports.site')}
              value={siteId}
              onChange={(e) => set({ site: e.target.value })}
            >
              <option value="">{t('reports.allSites')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button disabled={busy || !sheets || empty} onClick={() => void download()}>
            <Download aria-hidden /> {busy ? t('reports.downloading') : t('reports.download')}
          </Button>
        </div>
        {TABS.map((x) => (
          <TabsContent key={x} value={x} className="space-y-3 pt-3">
            <p className="max-w-3xl text-sm text-muted-foreground">{t(`reports.guides.${x}`)}</p>
            {current.isError ? (
              <p role="alert" className="text-destructive">
                {current.error.message}
              </p>
            ) : !sheets ? (
              <Skeleton className="h-40" />
            ) : empty ? (
              <p className="text-sm text-muted-foreground">{t('reports.empty')}</p>
            ) : x === 'boq' ? (
              sheets.map((s) => <SheetPreview key={s.name} sheet={s} title={s.name} />)
            ) : (
              <SheetPreview sheet={sheets[0]!} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
