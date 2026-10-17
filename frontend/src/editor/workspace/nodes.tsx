import {
  Handle,
  Position,
  useStore as useFlowStore,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { Boxes, CircleHelp, Lock } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { DeviceIcon } from '../catalog/icons'
import { useDoc } from './context'
import type { RefData } from './flow'

// Canvas nodes (P1-14). Each node subscribes to its own card only, so editing one device re-renders one node
// (CLAUDE.md editor rule). Links attach to the hidden handles; picking ports comes with wiring (P1-17).

type RefFlowNode = Node<RefData>

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

/** Secondary labels hide below 50 % zoom (SRS §6.3). */
const useShowDetails = () => useFlowStore((s) => s.transform[2] >= 0.5)

function Frame({
  selected,
  connectable = false,
  locked,
  draft,
  title,
  icon,
  label,
  detail,
}: {
  selected: boolean
  connectable?: boolean
  locked: boolean
  draft: boolean
  title: string
  icon: ReactNode
  label: string
  detail?: string
}) {
  const { t } = useTranslation()
  const showDetails = useShowDetails()
  return (
    <div
      title={title}
      className={cn(
        'relative flex w-36 flex-col items-center gap-1 rounded-md border bg-card px-2 py-2 text-card-foreground shadow-sm',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border-control',
      )}
    >
      {/* Cables are drawn border to border (CableEdge); these anchor them, and on hover start a new cable (P1-17). */}
      <Handle type="target" position={Position.Top} isConnectable={false} className="ntb-handle" />
      {connectable &&
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
      {icon}
      <span className="w-full truncate text-center text-xs font-medium">{label}</span>
      {showDetails && detail && (
        <span className="w-full truncate text-center text-[10px] text-muted-foreground">
          {detail}
        </span>
      )}
      {locked && (
        <Lock
          aria-label={t('editorCanvas.locked')}
          className="absolute top-1 right-1 size-3 text-muted-foreground"
        />
      )}
      {/* Dashed borders are for unmanaged devices (SRS §6.3); a new, unsaved device gets a badge. */}
      {draft && (
        <span className="absolute -top-2 left-2 rounded-sm border border-status-warning bg-card px-1 text-[10px] leading-4 text-status-warning">
          {t('editorDoc.unsaved')}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="ntb-handle"
      />
    </div>
  )
}

function DeviceNodeImpl({ data, selected, isConnectable }: NodeProps<RefFlowNode>) {
  const { t } = useTranslation()
  const card = useDoc((s) => s.doc?.devices[data.refId])
  if (!card) return <HiddenFrame selected={selected} />
  const type = t(`devices.types.${card.type}`)
  return (
    <Frame
      selected={selected}
      connectable={isConnectable}
      locked={data.locked}
      draft={card.draft === true}
      title={`${card.hostname} · ${type}`}
      icon={<DeviceIcon typeId={card.type} size={32} />}
      label={card.hostname}
      detail={type}
    />
  )
}

function GroupNodeImpl({ data, selected, isConnectable }: NodeProps<RefFlowNode>) {
  const { t } = useTranslation()
  const group = useDoc((s) => s.doc?.groups[data.refId])
  if (!group) return <HiddenFrame selected={selected} />
  return (
    <Frame
      selected={selected}
      connectable={isConnectable}
      locked={data.locked}
      draft={false}
      title={group.name}
      icon={<Boxes aria-hidden className="size-8 text-muted-foreground" />}
      label={group.name}
      detail={t('editorCanvas.group')}
    />
  )
}

/** Objects the editor does not draw yet (sites, other diagrams) or no longer knows. */
function HiddenFrame({ selected }: { selected: boolean }) {
  const { t } = useTranslation()
  return (
    <Frame
      selected={selected}
      locked={false}
      draft={false}
      title={t('editorDoc.hidden')}
      icon={<CircleHelp aria-hidden className="size-8 text-muted-foreground" />}
      label={t('editorCanvas.unknown')}
    />
  )
}

function RefNodeImpl({ selected }: NodeProps<RefFlowNode>) {
  return <HiddenFrame selected={selected} />
}

export const DeviceNode = memo(DeviceNodeImpl)
export const GroupNode = memo(GroupNodeImpl)
export const RefNode = memo(RefNodeImpl)
