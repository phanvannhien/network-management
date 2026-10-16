import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { connectPorts } from '../model/commands'
import { useAppStore } from '../model/store'
import { kindForMediaGroup, mediaGroup, usedPorts, type MediaGroup } from '../model/ports'
import type { Device, Interface, Link } from '../../types/ntb'

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
  const { t } = useTranslation()
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('editor.connectTitle', { a: source.hostname, b: target.hostname })}
          </DialogTitle>
          <DialogDescription>
            {t('editor.linkKind', { kind: t(`editor.kinds.${kind}`) })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <PortSelect
            label={t('editor.portOf', { host: source.hostname })}
            device={source}
            group={group}
            used={used}
            value={chosenSource}
            onChange={setSourcePortId}
          />
          <PortSelect
            label={t('editor.portOf', { host: target.hostname })}
            device={target}
            group={group}
            used={used}
            value={chosenTarget}
            onChange={setTargetPortId}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            {t('editor.connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation()
  return (
    <label className="block space-y-1">
      <span className="block font-medium">{label}</span>
      <NativeSelect
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-tech"
      >
        {device.interfaces.map((iface: Interface) => {
          const isUsed = used.has(`${device.id}:${iface.id}`)
          const wrongMedia = mediaGroup(iface.media) !== group
          const disabled =
            isUsed || wrongMedia || iface.media === 'logical' || iface.media === 'console'
          const suffix = isUsed
            ? ` — ${t('editor.portUsed')}`
            : disabled
              ? ` — ${t('editor.portWrong')}`
              : ''
          return (
            <option key={iface.id} value={iface.id} disabled={disabled}>
              {iface.name} ({iface.media}/{iface.speed}){suffix}
            </option>
          )
        })}
      </NativeSelect>
    </label>
  )
}
