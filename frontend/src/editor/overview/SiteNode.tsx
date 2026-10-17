import {
  Handle,
  Position,
  useStore as useFlowStore,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Building, Building2, Factory, Server, Store, Warehouse, Wifi } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { cn } from '@/lib/utils'
import type { RefData } from '../workspace/flow'
import { wanLabel } from './labels'
import { SITE_H, SITE_W, useSiteGraph, type SiteCard } from './siteGraph'

// A site on an overview (P2-21, ADR-040): code + name, its ISP lines, its gateway and counts — all live from the
// inventory; the node stores only its position. Dashed while the site is mostly planned (design templates, P2-23).

const KIND_ICON: Record<SiteCard['kind'], ReactNode> = {
  office: <Building2 aria-hidden className="size-5" />,
  factory: <Factory aria-hidden className="size-5" />,
  datacenter: <Server aria-hidden className="size-5" />,
  warehouse: <Warehouse aria-hidden className="size-5" />,
  store: <Store aria-hidden className="size-5" />,
  other: <Building aria-hidden className="size-5" />,
}

function SiteNodeImpl({ data, selected }: NodeProps<Node<RefData>>) {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const graph = useSiteGraph(orgId)
  const showDetails = useFlowStore((s) => s.transform[2] >= 0.35)
  const card = graph.data?.sites.find((s) => s.id === data.refId)
  const planned = card ? card.devices > 0 && card.planned * 2 >= card.devices : false
  return (
    <div
      title={
        card
          ? `${card.code} · ${card.name}${card.categoryPath ? ` (${card.categoryPath})` : ''}`
          : undefined
      }
      className={cn(
        'flex flex-col gap-1 rounded-lg border-2 bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border-control',
        planned && 'border-dashed',
      )}
      style={{ width: SITE_W, minHeight: SITE_H }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="ntb-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="ntb-handle"
      />
      {!card ? (
        <span className="text-sm text-muted-foreground">
          {graph.isPending ? t('overview.loading') : t('overview.siteGone')}
        </span>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-primary">{KIND_ICON[card.kind]}</span>
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-semibold">{card.localCode}</div>
              <div className="truncate text-xs">{card.name}</div>
            </div>
          </div>
          {showDetails && (
            <>
              {card.wan.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {card.wan.slice(0, 3).map((w, i) => (
                    <span
                      key={`${w.provider}-${w.service}-${i}`}
                      className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 text-[10px]"
                    >
                      <Wifi aria-hidden className="size-2.5" />
                      {wanLabel(w, t)}
                    </span>
                  ))}
                </div>
              )}
              <div className="truncate text-[11px] text-muted-foreground">
                {[
                  card.gateway,
                  t('overview.counts', { devices: card.devices, groups: card.groups }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {planned && (
                <div className="text-[10px] text-muted-foreground">{t('overview.planned')}</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export const SiteNode = memo(SiteNodeImpl)
