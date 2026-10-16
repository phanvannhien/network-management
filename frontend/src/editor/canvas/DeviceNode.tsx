import { Handle, Position, useStore, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { SEVERITY } from '../panels/Problems'
import { DeviceIcon } from '../catalog/icons'
import { useAppStore } from '../model/store'
import { severityForDevice } from '../validation/rules'

/**
 * Custom React Flow node rendering one device. Subscribes only to its own
 * device in the store so moving one node does not re-render the others
 * (CLAUDE.md performance rule). Renders the page's label template; secondary
 * label lines hide below 50% zoom (SRS §4).
 */
function DeviceNodeImpl({ id, data, selected }: NodeProps) {
  const { t } = useTranslation()
  const device = useAppStore((s) => s.data.devices[id])
  const zoom = useStore((s) => s.transform[2])
  const severity = useAppStore((s) => severityForDevice(s.problems, id))
  if (!device) return null

  const labelLines = (data.label as string | undefined) ?? device.hostname
  const [primary, ...secondary] = labelLines.split('\n')

  return (
    <div
      className={`flex w-28 flex-col items-center gap-1 rounded-md border bg-card px-2 py-2 text-card-foreground shadow-sm transition-shadow ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-border-control'
      }`}
      title={[device.hostname, device.mgmtIp, device.vendor, device.model]
        .filter(Boolean)
        .join(' · ')}
    >
      {/* Single connection point per device; the exact port is picked in the LinkDialog popup. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !bg-muted"
        isConnectable={false}
      />
      <div className="relative">
        <DeviceIcon typeId={device.type} size={32} />
        {severity !== null &&
          (() => {
            const { icon: Icon, color } = SEVERITY[severity]
            return (
              <span
                className="absolute -top-1.5 -right-2.5 grid place-items-center rounded-full bg-card"
                title={t('editor.validationBadge', { severity: t(`editor.severity.${severity}`) })}
              >
                <Icon aria-hidden className="size-3.5" style={{ color }} strokeWidth={2.25} />
              </span>
            )
          })()}
      </div>
      <span className="w-full truncate text-center text-xs font-medium">{primary}</span>
      {zoom >= 0.5 &&
        secondary
          .filter((line) => line.trim() !== '')
          .map((line, i) => (
            <span key={i} className="w-full truncate text-center text-[10px] text-muted-foreground">
              {line}
            </span>
          ))}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border !bg-muted"
        isConnectable={true}
      />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeImpl)
