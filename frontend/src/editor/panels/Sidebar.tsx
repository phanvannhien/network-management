import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import i18n from '@/i18n'
import { updateDevicesBulk, updateDevice, updateInterface, updateLink } from '../model/commands'
import { useAppStore } from '../model/store'
import { isValidCidr, parseCidrList } from '../../lib/validate'
import type { Device, Interface, Link } from '../../types/ntb'

type Tab = 'general' | 'interfaces' | 'links'

const TABS: { id: Tab; label: 'editor.tabGeneral' | 'editor.tabInterfaces' | 'editor.tabLinks' }[] =
  [
    { id: 'general', label: 'editor.tabGeneral' },
    { id: 'interfaces', label: 'editor.tabInterfaces' },
    { id: 'links', label: 'editor.tabLinks' },
  ]

/**
 * Right sidebar (SRS §5): tabs General / Interfaces / Links for a single
 * selected device; bulk form (role / lifecycle / site) when several devices
 * are selected. Text fields commit on blur, selects/checkboxes immediately.
 */
export function Sidebar() {
  const { t } = useTranslation()
  const selection = useAppStore((s) => s.selection)
  const devices = useAppStore((s) => s.data.devices)
  const [tab, setTab] = useState<Tab>('general')

  const selectedDevices = selection.map((id) => devices[id]).filter(Boolean)

  if (selectedDevices.length === 0) {
    return (
      <aside
        aria-label={t('editor.properties')}
        className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-card"
      >
        <p className="p-4 text-muted-foreground">{t('editor.selectHint')}</p>
      </aside>
    )
  }

  return (
    <aside
      aria-label={t('editor.properties')}
      className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-card"
    >
      <div
        role="tablist"
        aria-label={t('editor.properties')}
        className="flex border-b border-border"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-9 flex-1 px-2 font-medium ${
              tab === id
                ? 'text-foreground shadow-[inset_0_-2px_0_var(--brand)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {selectedDevices.length === 1 ? (
          <>
            {tab === 'general' && <GeneralForm device={selectedDevices[0]} />}
            {tab === 'interfaces' && <InterfacesForm device={selectedDevices[0]} />}
            {tab === 'links' && <LinksForm device={selectedDevices[0]} />}
          </>
        ) : (
          <BulkForm devices={selectedDevices} />
        )}
      </div>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block space-y-1">
      <span className="block text-label text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const tr = (key: string) => i18n.t(key as never)

const ROLE_OPTIONS = ['none', 'core', 'distribution', 'access', 'edge', 'dmz', 'oob'] as const
const LIFECYCLE_OPTIONS = ['existing', 'planned', 'to_be_removed'] as const
const MODE_OPTIONS = ['access', 'trunk', 'routed', 'lag_member'] as const
const IF_SPEED_OPTIONS = [
  '10M',
  '100M',
  '1G',
  '2.5G',
  '5G',
  '10G',
  '25G',
  '40G',
  '100G',
  'auto',
] as const
const LINK_STATUS_OPTIONS = ['up', 'down', 'admin_down', 'planned'] as const

function GeneralForm({ device }: { device: Device }) {
  const { t } = useTranslation()
  const [mgmtIp, setMgmtIp] = useState(device.mgmtIp ?? '')
  const cidrValid = isValidCidr(mgmtIp)

  return (
    <div data-testid="general-form">
      <Row label={t('editor.hostname')}>
        <Input
          value={device.hostname}
          onChange={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { hostname: e.target.value }))
          }
        />
      </Row>
      <Row label={t('editor.vendor')}>
        <Input
          value={device.vendor ?? ''}
          onBlur={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { vendor: e.target.value }))
          }
          defaultValue={device.vendor ?? ''}
        />
      </Row>
      <Row label={t('editor.model')}>
        <Input
          defaultValue={device.model ?? ''}
          onBlur={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { model: e.target.value }))
          }
        />
      </Row>
      <Row label={t('editor.role')}>
        <NativeSelect
          value={device.role ?? 'none'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateDevice(device.id, { role: e.target.value as Device['role'] }))
          }
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {tr(`editor.roles.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t('editor.lifecycle')}>
        <NativeSelect
          value={device.lifecycle ?? 'planned'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(
                updateDevice(device.id, { lifecycle: e.target.value as Device['lifecycle'] }),
              )
          }
        >
          {LIFECYCLE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {tr(`editor.lifecycles.${l}`)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t('editor.mgmtIp')}>
        <Input
          aria-invalid={cidrValid ? undefined : true}
          className="font-mono"
          value={mgmtIp}
          onChange={(e) => setMgmtIp(e.target.value)}
          onBlur={() => {
            if (cidrValid)
              useAppStore
                .getState()
                .dispatch(updateDevice(device.id, { mgmtIp: mgmtIp.trim() || undefined }))
            else setMgmtIp(device.mgmtIp ?? '')
          }}
        />
        {!cidrValid && (
          <span role="alert" className="text-label text-destructive">
            {t('editor.mgmtIpInvalid')}
          </span>
        )}
      </Row>
      <Row label={t('editor.site')}>
        <Input
          defaultValue={device.site ?? ''}
          onBlur={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { site: e.target.value }))
          }
        />
      </Row>
    </div>
  )
}

function InterfacesForm({ device }: { device: Device }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3" data-testid="interfaces-form">
      <p className="text-muted-foreground">
        {t('editor.interfacesCount', { count: device.interfaces.length })}
      </p>
      {device.interfaces.map((iface) => (
        <InterfaceRow key={iface.id} deviceId={device.id} iface={iface} />
      ))}
    </div>
  )
}

function InterfaceRow({ deviceId, iface }: { deviceId: string; iface: Interface }) {
  const { t } = useTranslation()
  const [ipText, setIpText] = useState(iface.ipAddresses?.join(', ') ?? '')
  const ipsValid = parseSafe(ipText)

  function parseSafe(text: string): boolean {
    try {
      parseCidrList(text)
      return true
    } catch {
      return false
    }
  }

  const commitIps = () => {
    if (!ipsValid) {
      setIpText(iface.ipAddresses?.join(', ') ?? '')
      return
    }
    useAppStore
      .getState()
      .dispatch(updateInterface(deviceId, iface.id, { ipAddresses: parseCidrList(ipText) }))
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-tech font-medium">{iface.name}</span>
        <span className="text-muted-foreground">
          {iface.media} · {iface.speed}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <NativeSelect
          value={iface.mode ?? 'access'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(
                updateInterface(deviceId, iface.id, { mode: e.target.value as Interface['mode'] }),
              )
          }
          aria-label={t('editor.ifMode', { name: iface.name })}
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {tr(`editor.modes.${m}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={iface.speed}
          onChange={(e) =>
            useAppStore.getState().dispatch(
              updateInterface(deviceId, iface.id, {
                speed: e.target.value as Interface['speed'],
              }),
            )
          }
          aria-label={t('editor.ifSpeed', { name: iface.name })}
        >
          {IF_SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Input
        className="mt-1.5 font-mono"
        aria-invalid={ipsValid ? undefined : true}
        value={ipText}
        onChange={(e) => setIpText(e.target.value)}
        onBlur={commitIps}
        placeholder={t('editor.ipsPlaceholder')}
        aria-label={t('editor.ifIps', { name: iface.name })}
      />
      <div className="mt-1.5 flex gap-4">
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={iface.poe}
            onCheckedChange={(on) =>
              useAppStore.getState().dispatch(updateInterface(deviceId, iface.id, { poe: !!on }))
            }
          />
          {t('editor.poe')}
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={iface.adminUp}
            onCheckedChange={(on) =>
              useAppStore
                .getState()
                .dispatch(updateInterface(deviceId, iface.id, { adminUp: !!on }))
            }
          />
          {t('editor.adminUp')}
        </label>
      </div>
    </div>
  )
}

function LinksForm({ device }: { device: Device }) {
  const { t } = useTranslation()
  const data = useAppStore((s) => s.data)
  const links = Object.values(data.links).filter(
    (l) => l.a.deviceId === device.id || l.b.deviceId === device.id,
  )

  if (links.length === 0) {
    return (
      <p className="text-muted-foreground" data-testid="links-form">
        {t('editor.noLinks')}
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="links-form">
      <p className="text-muted-foreground">{t('editor.linksCount', { count: links.length })}</p>
      {links.map((link) => (
        <LinkRow key={link.id} device={device} link={link} />
      ))}
    </div>
  )
}

function LinkRow({ device, link }: { device: Device; link: Link }) {
  const { t } = useTranslation()
  const data = useAppStore((s) => s.data)
  const isA = link.a.deviceId === device.id
  const peer = data.devices[isA ? link.b.deviceId : link.a.deviceId]
  const peerInterfaceId = isA ? link.b.interfaceId : link.a.interfaceId
  const ownInterfaceId = isA ? link.a.interfaceId : link.b.interfaceId
  const peerPort = peer?.interfaces.find((i) => i.id === peerInterfaceId)?.name ?? '?'
  const ownPort = device.interfaces.find((i) => i.id === ownInterfaceId)?.name ?? '?'
  const [notes, setNotes] = useState(link.notes ?? '')

  return (
    <div className="rounded-md border border-border p-2">
      <p className="mb-1.5">
        <span className="font-mono text-tech">{ownPort}</span> ↔{' '}
        <span className="font-medium">{peer?.hostname ?? '?'}</span>{' '}
        <span className="font-mono text-tech">({peerPort})</span>
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <NativeSelect
          value={link.status ?? 'planned'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateLink(link.id, { status: e.target.value as Link['status'] }))
          }
          aria-label={t('editor.linkStatus')}
        >
          {LINK_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {tr(`editor.linkStatuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={link.speed ?? 'auto'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateLink(link.id, { speed: e.target.value as Link['speed'] }))
          }
          aria-label={t('editor.linkSpeed')}
        >
          <option value="">—</option>
          {IF_SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Input
        className="mt-1.5 font-mono"
        defaultValue={link.cableId ?? ''}
        placeholder={t('editor.cableId')}
        aria-label={t('editor.cableId')}
        onBlur={(e) =>
          useAppStore.getState().dispatch(updateLink(link.id, { cableId: e.target.value }))
        }
      />
      <Input
        className="mt-1.5"
        type="number"
        min={0}
        defaultValue={link.lengthM ?? ''}
        placeholder={t('editor.lengthM')}
        aria-label={t('editor.lengthM')}
        onBlur={(e) =>
          useAppStore.getState().dispatch(
            updateLink(link.id, {
              lengthM: e.target.value === '' ? undefined : Number(e.target.value),
            }),
          )
        }
      />
      <Input
        className="mt-1.5"
        value={notes}
        placeholder={t('editor.notes')}
        aria-label={t('editor.notes')}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => useAppStore.getState().dispatch(updateLink(link.id, { notes }))}
      />
    </div>
  )
}

function BulkForm({ devices }: { devices: Device[] }) {
  const { t } = useTranslation()
  const [role, setRole] = useState<Device['role'] | ''>('')
  const [lifecycle, setLifecycle] = useState<Device['lifecycle'] | ''>('')
  const [site, setSite] = useState('')

  const apply = () => {
    const patch: Parameters<typeof updateDevicesBulk>[1] = {}
    if (role !== '') patch.role = role
    if (lifecycle !== '') patch.lifecycle = lifecycle
    if (site !== '') patch.site = site
    if (Object.keys(patch).length === 0) return
    useAppStore.getState().dispatch(
      updateDevicesBulk(
        devices.map((d) => d.id),
        patch,
      ),
    )
  }

  return (
    <div data-testid="bulk-form">
      <p className="mb-3 font-medium">{t('editor.bulkTitle', { count: devices.length })}</p>
      <Row label={t('editor.role')}>
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Device['role'] | '')}>
          <option value="">{t('editor.unchanged')}</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {tr(`editor.roles.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t('editor.lifecycle')}>
        <NativeSelect
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as Device['lifecycle'] | '')}
        >
          <option value="">{t('editor.unchanged')}</option>
          {LIFECYCLE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {tr(`editor.lifecycles.${l}`)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t('editor.site')}>
        <Input
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder={t('editor.unchanged')}
        />
      </Row>
      <Button onClick={apply} className="w-full">
        {t('editor.apply')}
      </Button>
    </div>
  )
}
