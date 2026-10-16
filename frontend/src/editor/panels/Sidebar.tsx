import { useState } from 'react'
import { updateDevicesBulk, updateDevice, updateInterface, updateLink } from '../model/commands'
import { useAppStore } from '../model/store'
import { isValidCidr, parseCidrList } from '../../lib/validate'
import type { Device, Interface, Link } from '../../types/ntb'

type Tab = 'general' | 'interfaces' | 'links'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interfaces', label: 'Interfaces' },
  { id: 'links', label: 'Links' },
]

/**
 * Right sidebar (SRS §5): tabs General / Interfaces / Links for a single
 * selected device; bulk form (role / lifecycle / site) when several devices
 * are selected. Text fields commit on blur, selects/checkboxes immediately.
 */
export function Sidebar() {
  const selection = useAppStore((s) => s.selection)
  const devices = useAppStore((s) => s.data.devices)
  const [tab, setTab] = useState<Tab>('general')

  const selectedDevices = selection.map((id) => devices[id]).filter(Boolean)

  if (selectedDevices.length === 0) {
    return (
      <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background">
        <p className="p-4 text-xs text-muted-foreground">Chọn một thiết bị để xem thuộc tính.</p>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 px-2 py-2 text-xs font-medium ${
              tab === id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
            }`}
          >
            {label}
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

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring'
const labelClass = 'mb-1 block text-xs text-muted-foreground'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

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
  const [mgmtIp, setMgmtIp] = useState(device.mgmtIp ?? '')
  const cidrValid = isValidCidr(mgmtIp)

  return (
    <div data-testid="general-form">
      <Row label="Hostname">
        <input
          className={inputClass}
          value={device.hostname}
          onChange={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { hostname: e.target.value }))
          }
        />
      </Row>
      <Row label="Vendor">
        <input
          className={inputClass}
          value={device.vendor ?? ''}
          onBlur={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { vendor: e.target.value }))
          }
          defaultValue={device.vendor ?? ''}
        />
      </Row>
      <Row label="Model">
        <input
          className={inputClass}
          defaultValue={device.model ?? ''}
          onBlur={(e) =>
            useAppStore.getState().dispatch(updateDevice(device.id, { model: e.target.value }))
          }
        />
      </Row>
      <Row label="Role">
        <select
          className={inputClass}
          value={device.role ?? 'none'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateDevice(device.id, { role: e.target.value as Device['role'] }))
          }
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Lifecycle">
        <select
          className={inputClass}
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
              {l}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Management IP (CIDR)">
        <input
          className={`${inputClass} ${cidrValid ? '' : 'border-destructive'}`}
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
          <span className="text-xs text-destructive">IP không hợp lệ (dạng 10.0.0.1/24)</span>
        )}
      </Row>
      <Row label="Site">
        <input
          className={inputClass}
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
  return (
    <div className="space-y-3" data-testid="interfaces-form">
      <p className="text-xs text-muted-foreground">{device.interfaces.length} interfaces</p>
      {device.interfaces.map((iface) => (
        <InterfaceRow key={iface.id} deviceId={device.id} iface={iface} />
      ))}
    </div>
  )
}

function InterfaceRow({ deviceId, iface }: { deviceId: string; iface: Interface }) {
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
    <div className="rounded-md border border-border p-2 text-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium">{iface.name}</span>
        <span className="text-muted-foreground">
          {iface.media} · {iface.speed}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          className={inputClass}
          value={iface.mode ?? 'access'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(
                updateInterface(deviceId, iface.id, { mode: e.target.value as Interface['mode'] }),
              )
          }
          aria-label={`${iface.name} mode`}
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={iface.speed}
          onChange={(e) =>
            useAppStore.getState().dispatch(
              updateInterface(deviceId, iface.id, {
                speed: e.target.value as Interface['speed'],
              }),
            )
          }
          aria-label={`${iface.name} speed`}
        >
          {IF_SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <input
        className={`${inputClass} mt-1.5 ${ipsValid ? '' : 'border-destructive'}`}
        value={ipText}
        onChange={(e) => setIpText(e.target.value)}
        onBlur={commitIps}
        placeholder="IP dạng CIDR, cách nhau bởi dấu phẩy"
        aria-label={`${iface.name} IPs`}
      />
      <div className="mt-1.5 flex gap-4">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={iface.poe}
            onChange={(e) =>
              useAppStore
                .getState()
                .dispatch(updateInterface(deviceId, iface.id, { poe: e.target.checked }))
            }
          />
          PoE
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={iface.adminUp}
            onChange={(e) =>
              useAppStore
                .getState()
                .dispatch(updateInterface(deviceId, iface.id, { adminUp: e.target.checked }))
            }
          />
          Admin up
        </label>
      </div>
    </div>
  )
}

function LinksForm({ device }: { device: Device }) {
  const data = useAppStore((s) => s.data)
  const links = Object.values(data.links).filter(
    (l) => l.a.deviceId === device.id || l.b.deviceId === device.id,
  )

  if (links.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="links-form">
        Chưa có link nào.
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="links-form">
      <p className="text-xs text-muted-foreground">{links.length} links</p>
      {links.map((link) => (
        <LinkRow key={link.id} device={device} link={link} />
      ))}
    </div>
  )
}

function LinkRow({ device, link }: { device: Device; link: Link }) {
  const data = useAppStore((s) => s.data)
  const isA = link.a.deviceId === device.id
  const peer = data.devices[isA ? link.b.deviceId : link.a.deviceId]
  const peerInterfaceId = isA ? link.b.interfaceId : link.a.interfaceId
  const ownInterfaceId = isA ? link.a.interfaceId : link.b.interfaceId
  const peerPort = peer?.interfaces.find((i) => i.id === peerInterfaceId)?.name ?? '?'
  const ownPort = device.interfaces.find((i) => i.id === ownInterfaceId)?.name ?? '?'
  const [notes, setNotes] = useState(link.notes ?? '')

  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <p className="mb-1.5 font-medium">
        {ownPort} ↔ {peer?.hostname ?? '?'} ({peerPort})
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          className={inputClass}
          value={link.status ?? 'planned'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateLink(link.id, { status: e.target.value as Link['status'] }))
          }
          aria-label="Link status"
        >
          {LINK_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={link.speed ?? 'auto'}
          onChange={(e) =>
            useAppStore
              .getState()
              .dispatch(updateLink(link.id, { speed: e.target.value as Link['speed'] }))
          }
          aria-label="Link speed"
        >
          <option value="">—</option>
          {IF_SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <input
        className={`${inputClass} mt-1.5`}
        defaultValue={link.cableId ?? ''}
        placeholder="Cable ID"
        aria-label="Cable ID"
        onBlur={(e) =>
          useAppStore.getState().dispatch(updateLink(link.id, { cableId: e.target.value }))
        }
      />
      <input
        className={`${inputClass} mt-1.5`}
        type="number"
        min={0}
        defaultValue={link.lengthM ?? ''}
        placeholder="Chiều dài (m)"
        aria-label="Link length (m)"
        onBlur={(e) =>
          useAppStore.getState().dispatch(
            updateLink(link.id, {
              lengthM: e.target.value === '' ? undefined : Number(e.target.value),
            }),
          )
        }
      />
      <input
        className={`${inputClass} mt-1.5`}
        value={notes}
        placeholder="Ghi chú"
        aria-label="Link notes"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => useAppStore.getState().dispatch(updateLink(link.id, { notes }))}
      />
    </div>
  )
}

function BulkForm({ devices }: { devices: Device[] }) {
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
      <p className="mb-2 text-xs text-muted-foreground">
        Sửa hàng loạt · {devices.length} thiết bị
      </p>
      <Row label="Role">
        <select
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as Device['role'] | '')}
        >
          <option value="">— không đổi —</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Lifecycle">
        <select
          className={inputClass}
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as Device['lifecycle'] | '')}
        >
          <option value="">— không đổi —</option>
          {LIFECYCLE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Site">
        <input
          className={inputClass}
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="— không đổi —"
        />
      </Row>
      <button
        type="button"
        onClick={apply}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
      >
        Áp dụng
      </button>
    </div>
  )
}
