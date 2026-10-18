import { useQueries } from '@tanstack/react-query'
import type { Node, NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { cn } from '@/lib/utils'
import { subnetQuery, usageLevel, usagePercent, useSubnets } from '@/modules/ipam/ipam'
import { useSites } from '@/modules/sites/sites'
import type { AnnotationData } from './annotationNodes'
import { useDoc } from './context'

export type IpPlanFlowNode = Node<AnnotationData>

/** Rows shown before "+N more" (the table goes into PNG / PDF exports). */
const MAX_ROWS = 30

/**
 * The IP plan of a site on the diagram (P2-09, SRS §5): its subnets with VLAN, gateway and ranges, read live from IPAM
 * (never typed on the diagram). Sorted by VLAN then subnet; plan blocks (no gateway / VLAN / range) are left out.
 */
function IpPlanNodeImpl({ data, selected }: NodeProps<IpPlanFlowNode>) {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const a = useDoc((s) => s.doc?.view.annotations.find((x) => x.id === data.annotationId))
  const siteId = a?.siteId ?? ''
  const sites = useSites(orgId, siteId !== '')
  const list = useSubnets(orgId, siteId, '')
  const subnets = (list.data ?? [])
    .filter((s) => s.siteId === siteId && (s.gateway || s.vlanId || s.rangeCount > 0))
    .sort((x, y) => (x.vlanVid ?? 99999) - (y.vlanVid ?? 99999) || x.cidr.localeCompare(y.cidr))
  const shown = subnets.slice(0, MAX_ROWS)
  const details = useQueries({ queries: shown.map((s) => subnetQuery(orgId, s.id)) })
  const site = sites.data?.find((s) => s.id === siteId)
  if (!a) return null
  return (
    <div
      className={cn(
        'min-w-[420px] rounded-md border border-border bg-card text-card-foreground shadow-sm',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="border-b border-border px-2 py-1 text-xs font-semibold">
        {t('ipPlan.title', { site: site ? `${site.code} · ${site.name}` : '…' })}
      </div>
      {subnets.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">{t('ipPlan.empty')}</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-0.5 font-medium">VLAN</th>
              <th className="px-2 py-0.5 font-medium">Subnet</th>
              <th className="px-2 py-0.5 font-medium">Gateway</th>
              <th className="px-2 py-0.5 font-medium">{t('ipPlan.ranges')}</th>
              <th className="px-2 py-0.5 text-right font-medium">{t('ipPlan.used')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s, i) => {
              const ranges = details[i]?.data?.ranges ?? []
              const pct = usagePercent(s.usedCount, s.size)
              return (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="px-2 py-0.5 whitespace-nowrap">
                    {s.vlanVid ? (
                      <span className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: s.vlanColor || '#64748b' }}
                          aria-hidden
                        />
                        <span className="font-mono">{s.vlanVid}</span> {s.vlanName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-0.5 font-mono whitespace-nowrap">
                    {s.cidr}
                    {s.vrf && <span className="text-muted-foreground"> · {s.vrf}</span>}
                  </td>
                  <td className="px-2 py-0.5 font-mono">{s.gateway || '—'}</td>
                  <td className="px-2 py-0.5">
                    {ranges.length === 0
                      ? s.description || '—'
                      : ranges.map((r) => (
                          <div key={r.id} className="whitespace-nowrap">
                            <span className="font-medium">{t(`ipam.rangeKinds.${r.kind}`)}</span>{' '}
                            <span className="font-mono">
                              {r.startIp}–{r.endIp}
                            </span>
                            {r.purpose && (
                              <span className="text-muted-foreground"> · {r.purpose}</span>
                            )}
                          </div>
                        ))}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-0.5 text-right tabular-nums',
                      usageLevel(pct) === 'critical' && 'text-status-down',
                      usageLevel(pct) === 'warn' && 'text-status-warning',
                    )}
                  >
                    {pct}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {subnets.length > MAX_ROWS && (
        <p className="border-t border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {t('ipPlan.more', { count: subnets.length - MAX_ROWS })}
        </p>
      )}
    </div>
  )
}

export const IpPlanNode = memo(IpPlanNodeImpl)
