import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Cloud, Network } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { RefData } from './flow'
import { useDoc } from './context'

export type SegmentFlowNode = Node<RefData>

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

/**
 * A shared network (P2-08): one cloud every site's cable goes into — an MPLS / Metro service (cloud) or a shared LAN
 * (a wide bar). Cabled like a device, with no port at its end.
 */
function SegmentNodeImpl({ data, selected, isConnectable }: NodeProps<SegmentFlowNode>) {
  const { t } = useTranslation()
  const sg = useDoc((s) => s.doc?.segments?.[data.refId])
  const lan = sg?.kind === 'shared_lan'
  const Icon = lan ? Network : Cloud
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 border-2 border-dashed bg-card px-3 py-2 text-card-foreground shadow-sm',
        lan ? 'w-72 rounded-md' : 'w-48 rounded-[40px]',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border-control',
      )}
      title={
        sg
          ? [sg.name, t(`segments.kinds.${sg.kind}`), sg.vendorName, sg.serviceId]
              .filter(Boolean)
              .join(' · ')
          : ''
      }
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="ntb-handle" />
      {isConnectable &&
        SIDES.map((side) => (
          <Handle
            key={side}
            id={`c-${side}`}
            type="source"
            position={side}
            isConnectable
            className="ntb-connect"
          />
        ))}
      <Icon aria-hidden className="size-6 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-semibold">{sg?.name ?? t('segments.title')}</span>
        {sg && (
          <span className="truncate text-[10px] text-muted-foreground">
            {[t(`segments.kinds.${sg.kind}`), sg.vendorName, sg.serviceId]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="ntb-handle"
      />
    </div>
  )
}

export const SegmentNode = memo(SegmentNodeImpl)
