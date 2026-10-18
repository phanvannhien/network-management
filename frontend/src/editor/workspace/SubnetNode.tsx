import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { atLeast } from '@/modules/sites/access'
import type { RefData } from './flow'
import { useDoc } from './context'

export type SubnetFlowNode = Node<RefData>

/**
 * A subnet on an L3 page (P2-08): a horizontal bar "10.1.20.0/24 · VLAN 20 Camera · VRF CORP", tinted with its VLAN
 * colour; devices with an IP in it hang from it. Stretch it sideways when selected.
 */
function SubnetNodeImpl({ data, selected }: NodeProps<SubnetFlowNode>) {
  const { t } = useTranslation()
  const sn = useDoc((s) => s.doc?.l3?.subnets[data.refId])
  const canEdit = useDoc((s) => atLeast(s.meta?.access, 'edit'))
  const color = sn?.vlanColor || '#64748b'
  const parts = sn
    ? [
        sn.cidr,
        sn.vid ? `VLAN ${sn.vid}${sn.vlanName ? ` ${sn.vlanName}` : ''}` : '',
        sn.vrf ? `VRF ${sn.vrf}` : '',
        sn.description.split('\n')[0] ?? '',
      ].filter(Boolean)
    : [t('l3.subnet')]
  return (
    <div
      className="flex h-full w-full items-center gap-2 overflow-hidden rounded-sm border-2 px-2 text-[11px] font-medium"
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 14%, var(--card))`,
        boxShadow: selected ? '0 0 0 2px var(--ring)' : undefined,
      }}
      title={parts.join(' · ')}
    >
      <NodeResizer
        isVisible={selected && canEdit}
        minWidth={200}
        minHeight={30}
        maxHeight={30}
        lineClassName="ntb-resize-line"
        handleClassName="ntb-resize-handle"
      />
      {/* Lines attach to the bar's edges (L3Edge computes where); these only anchor them. */}
      <Handle type="target" position={Position.Top} isConnectable={false} className="ntb-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="ntb-handle"
      />
      <span className="truncate font-mono">{parts[0]}</span>
      {parts.slice(1).map((p) => (
        <span key={p} className="truncate text-muted-foreground">
          · {p}
        </span>
      ))}
    </div>
  )
}

export const SubnetNode = memo(SubnetNodeImpl)
