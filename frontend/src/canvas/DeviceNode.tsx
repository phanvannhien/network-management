import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { DeviceIcon } from '../catalog/icons'
import { useAppStore } from '../model/store'

/**
 * Custom React Flow node rendering one device. Subscribes only to its own
 * device in the store so moving one node does not re-render the others
 * (CLAUDE.md performance rule).
 */
function DeviceNodeImpl({ id, selected }: NodeProps) {
  const device = useAppStore((s) => s.data.devices[id])
  if (!device) return null

  return (
    <div
      className={`flex w-28 flex-col items-center gap-1 rounded-md border bg-card px-2 py-2 text-card-foreground shadow-sm transition-shadow ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-border'
      }`}
    >
      {/* Ports become real handles in P1-06; placeholders keep the layout ready. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !bg-muted"
        isConnectable={false}
      />
      <DeviceIcon typeId={device.type} size={32} />
      <span className="w-full truncate text-center text-xs font-medium">{device.hostname}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border !bg-muted"
        isConnectable={false}
      />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeImpl)
