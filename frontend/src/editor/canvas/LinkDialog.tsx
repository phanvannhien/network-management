import { useMemo, useState } from 'react'
import { connectPorts } from '../model/commands'
import { useAppStore } from '../model/store'
import { kindForMediaGroup, mediaGroup, usedPorts, type MediaGroup } from '../model/ports'
import type { Device, Interface, Link } from '../../types/ntb'

const KIND_LABELS: Record<Link['kind'], string> = {
  ethernet: 'Ethernet',
  fiber: 'Fiber',
  wireless: 'Wireless',
  serial: 'Serial',
  logical: 'Logical',
  console: 'Console',
}

const LINKABLE_GROUPS: MediaGroup[] = ['copper', 'fiber', 'wireless', 'serial']

export interface PendingConnection {
  sourceId: string
  targetId: string
}

function freePortInGroup(device: Device, group: MediaGroup, used: Set<string>): Interface | null {
  return (
    device.interfaces.find(
      (i) =>
        !used.has(`${device.id}:${i.id}`) &&
        mediaGroup(i.media) === group &&
        i.media !== 'logical' &&
        i.media !== 'console',
    ) ?? null
  )
}

/** Media group used for this connection: first group with free ports on BOTH devices. */
function connectionGroup(source: Device, target: Device, used: Set<string>): MediaGroup | null {
  for (const group of LINKABLE_GROUPS) {
    if (freePortInGroup(source, group, used) && freePortInGroup(target, group, used)) {
      return group
    }
  }
  return null
}

/**
 * Popup after dragging a connection between two devices (SRS §4): pick a free
 * port on each side (used / mismatched media disabled and dimmed); defaults
 * auto-assign the first free matching port. Not choosing = auto-assign.
 */
export function LinkDialog({
  pending,
  pageId,
  onClose,
}: {
  pending: PendingConnection
  pageId: string
  onClose: () => void
}) {
  const data = useAppStore((s) => s.data)
  const source = data.devices[pending.sourceId]
  const target = data.devices[pending.targetId]

  const used = useMemo(() => usedPorts(data), [data])
  const group = useMemo(
    () => (source && target ? connectionGroup(source, target, used) : null),
    [source, target, used],
  )
  const [sourcePortId, setSourcePortId] = useState<string | null>(null)
  const [targetPortId, setTargetPortId] = useState<string | null>(null)

  if (!source || !target || group === null) return null

  const chosenSource = sourcePortId ?? freePortInGroup(source, group, used)?.id ?? null
  const chosenTarget = targetPortId ?? freePortInGroup(target, group, used)?.id ?? null
  const kind = kindForMediaGroup(group) as Link['kind']
  const canCreate = chosenSource !== null && chosenTarget !== null

  const create = () => {
    if (!chosenSource || !chosenTarget) return
    useAppStore
      .getState()
      .dispatch(
        connectPorts(
          pageId,
          { deviceId: source.id, interfaceId: chosenSource },
          { deviceId: target.id, interfaceId: chosenTarget },
          kind,
        ),
      )
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-popover w-96 rounded-lg border border-border p-4 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold">
          Nối dây: {source.hostname} ↔ {target.hostname}
        </h2>
        <div className="space-y-3 text-sm">
          <PortSelect
            label={`Cổng ${source.hostname}`}
            device={source}
            group={group}
            used={used}
            value={chosenSource}
            onChange={setSourcePortId}
          />
          <PortSelect
            label={`Cổng ${target.hostname}`}
            device={target}
            group={group}
            used={used}
            value={chosenTarget}
            onChange={setTargetPortId}
          />
          <p className="text-xs text-muted-foreground">
            Loại link: {KIND_LABELS[kind]} (theo loại cổng)
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={create}
            disabled={!canCreate}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Nối
          </button>
        </div>
      </div>
    </div>
  )
}

function PortSelect({
  label,
  device,
  group,
  used,
  value,
  onChange,
}: {
  label: string
  device: Device
  group: MediaGroup
  used: Set<string>
  value: string | null
  onChange: (id: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5"
      >
        {device.interfaces.map((iface: Interface) => {
          const isUsed = used.has(`${device.id}:${iface.id}`)
          const wrongMedia = mediaGroup(iface.media) !== group
          const disabled =
            isUsed || wrongMedia || iface.media === 'logical' || iface.media === 'console'
          const suffix = isUsed
            ? ' — đã dùng'
            : wrongMedia || iface.media === 'logical' || iface.media === 'console'
              ? ' — sai loại'
              : ''
          return (
            <option
              key={iface.id}
              value={iface.id}
              disabled={disabled}
              className={disabled ? 'opacity-40' : ''}
            >
              {iface.name} ({iface.media}/{iface.speed}){suffix}
            </option>
          )
        })}
      </select>
    </label>
  )
}
