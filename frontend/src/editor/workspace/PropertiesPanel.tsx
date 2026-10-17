import { ExternalLink, Pencil, PanelRightClose, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldHelp } from '@/components/FieldHelp'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  DEVICE_ROLES,
  DEVICE_TYPE_GROUPS,
  LIFECYCLES,
  deviceToInput,
  useDevice,
  useDeviceIps,
  useInterfaces,
  type Device,
  type DeviceInput,
} from '@/modules/inventory/devices'
import {
  CONNECTORS,
  FIBER_MODES,
  LINK_MEDIA,
  LINK_SERVICES,
  LINK_STATUSES,
  useLinks,
  type LinkInput,
} from '@/modules/inventory/links'
import { useLocations, useSites } from '@/modules/sites/sites'
import {
  setLabelColor,
  setLabelTemplate,
  updateAnnotation,
  updateDevice,
  updateLink,
} from '../doc/commands'
import type { DocState } from '../doc/types'
import { useDoc, useDocStoreApi } from './context'
import { ANN, isAnnotationId } from './flow'
import { LABEL_COLORS, LABEL_PRESETS, presetOf } from './labels'
import { AddPorts } from './AddPorts'
import { PortIpam } from './PortIpam'
import { sortPorts, takenPorts } from './wiring'

/**
 * Property panel (P1-18, SRS §6.3): what is selected on the canvas, edited in place. Changes are commands (undo /
 * redo) saved with the diagram; "Apply" makes one step of a set of field edits. Nothing selected → diagram settings.
 */
export function PropertiesPanel({
  orgId,
  canEdit,
  onEditCable,
  onClose,
  onMinimize,
}: {
  orgId: string
  canEdit: boolean
  onEditCable: (edgeId: string) => void
  onClose: () => void
  /** Fold to a rail at the canvas edge. */
  onMinimize: () => void
}) {
  const { t } = useTranslation()
  const selection = useDoc((s) => s.selection)
  const edgeSelection = useDoc((s) => s.edgeSelection)
  const doc = useDoc((s) => s.doc)!
  let body: ReactNode
  let title: string = t('panel.diagram')
  const ann =
    selection.length === 1 && isAnnotationId(selection[0]!)
      ? doc.view.annotations.find((a) => ANN + a.id === selection[0])
      : undefined
  if (ann) {
    title = t(`frames.kinds.${ann.kind as 'zone'}`)
    body = <AnnotationPanel key={ann.id} orgId={orgId} annotationId={ann.id} canEdit={canEdit} />
  } else if (selection.length === 1) {
    const node = doc.view.nodes.find((n) => n.id === selection[0])
    if (node?.refKind === 'device' && doc.devices[node.refId]) {
      title = t('panel.device')
      body = (
        <DevicePanel
          key={node.refId}
          orgId={orgId}
          deviceId={node.refId}
          nodeId={node.id}
          canEdit={canEdit}
        />
      )
    } else if (node?.refKind === 'endpoint_group' && doc.groups[node.refId]) {
      title = t('panel.group')
      body = <GroupPanel orgId={orgId} groupId={node.refId} nodeId={node.id} canEdit={canEdit} />
    }
  } else if (selection.length > 1) {
    title = t('panel.many', { count: selection.length })
    body = <ManyPanel nodeIds={selection} canEdit={canEdit} />
  } else if (edgeSelection.length === 1) {
    const edge = doc.view.edges.find((e) => e.id === edgeSelection[0])
    if (edge && doc.links[edge.linkId]) {
      title = t('panel.cable')
      body = (
        <CablePanel
          key={edge.linkId}
          orgId={orgId}
          linkId={edge.linkId}
          canEdit={canEdit}
          onEditCable={() => onEditCable(edge.id)}
        />
      )
    }
  }
  body ??= <DiagramPanel canEdit={canEdit} />
  return (
    <aside
      aria-label={t('panel.title')}
      className="absolute top-16 right-3 bottom-48 z-10 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 truncate font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('panel.minimize')}
          title={t('panel.minimize')}
          onClick={onMinimize}
        >
          <PanelRightClose aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('panel.close')}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">{body}</div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-label font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono')}>{value || '—'}</dd>
    </div>
  )
}

/** Apply / reset bar for a set of field edits. */
function ApplyBar({
  dirty,
  onApply,
  onReset,
}: {
  dirty: boolean
  onApply: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  if (!dirty) return null
  return (
    <div className="sticky bottom-0 flex gap-2 border-t border-border bg-popover pt-2">
      <Button size="sm" onClick={onApply}>
        {t('panel.apply')}
      </Button>
      <Button size="sm" variant="outline" onClick={onReset}>
        {t('panel.reset')}
      </Button>
    </div>
  )
}

function LabelColorPicker({ nodeIds, current }: { nodeIds: string[]; current: string }) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  return (
    <div role="radiogroup" aria-label={t('panel.labelColor')} className="flex flex-wrap gap-1">
      {(['', ...LABEL_COLORS] as const).map((c) => (
        <button
          key={c || 'none'}
          type="button"
          role="radio"
          aria-checked={current === c}
          aria-label={t(`panel.colors.${c || 'none'}`)}
          title={t(`panel.colors.${c || 'none'}`)}
          onClick={() => store.getState().dispatch(setLabelColor(nodeIds, c))}
          className={cn(
            'size-6 rounded-sm border border-border-control',
            c ? `ntb-tag-${c}` : 'bg-card',
            current === c && 'ring-2 ring-primary',
          )}
        >
          {!c && <X aria-hidden className="m-auto size-3 text-muted-foreground" />}
        </button>
      ))}
    </div>
  )
}

function DiagramPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const doc = useDoc((s) => s.doc)!
  const preset = presetOf(doc.view.labelTemplate)
  return (
    <>
      <p className="text-muted-foreground">{t('panel.diagramHint')}</p>
      <dl className="space-y-1">
        <Row label={t('panel.devices')} value={String(doc.view.nodes.length)} />
        <Row label={t('panel.cables')} value={String(doc.view.edges.length)} />
      </dl>
      <FormField label={t('panel.labelTemplate')} guide={t('panel.labelTemplateGuide')}>
        {(p) => (
          <NativeSelect
            {...p}
            disabled={!canEdit}
            value={preset}
            onChange={(e) => {
              const tpl = LABEL_PRESETS.find((x) => x.id === e.target.value)!.template
              store
                .getState()
                .dispatch(setLabelTemplate(tpl === LABEL_PRESETS[0].template ? '' : tpl))
            }}
          >
            {LABEL_PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {t(`panel.labels.${x.id}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
    </>
  )
}

type DeviceFields = Pick<
  DeviceInput,
  'hostname' | 'type' | 'siteId' | 'vendor' | 'model' | 'role' | 'lifecycle' | 'managed' | 'notes'
> & { mgmtInterfaceId: string }

function fieldsOf(d: DeviceInput): DeviceFields {
  return {
    hostname: d.hostname,
    type: d.type,
    siteId: d.siteId,
    vendor: d.vendor ?? '',
    model: d.model ?? '',
    role: d.role ?? 'none',
    lifecycle: d.lifecycle ?? 'active',
    managed: d.managed ?? true,
    notes: d.notes ?? '',
    mgmtInterfaceId: d.mgmtInterfaceId ?? '',
  }
}

/** The device as the editor knows it: a pending create or edit, else the saved record. */
function useDeviceBase(orgId: string, doc: DocState, id: string) {
  const pending = doc.newDevices[id]
  const edited = doc.deviceEdits[id]
  const saved = useDevice(orgId, pending ? '' : id)
  if (pending) return { input: pending, version: 0, device: undefined, loading: false }
  if (edited) {
    const { version, ...input } = edited
    return { input: input as DeviceInput, version, device: saved.data, loading: false }
  }
  return {
    input: saved.data ? deviceToInput(saved.data) : undefined,
    version: saved.data?.version ?? 0,
    device: saved.data,
    loading: saved.isPending,
  }
}

function DevicePanel({
  orgId,
  deviceId,
  nodeId,
  canEdit,
}: {
  orgId: string
  deviceId: string
  nodeId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const doc = useDoc((s) => s.doc)!
  const card = doc.devices[deviceId]!
  const node = doc.view.nodes.find((n) => n.id === nodeId)
  const base = useDeviceBase(orgId, doc, deviceId)
  const sites = useSites(orgId)
  // The management IP on the node follows the server (IPAM writes from the panel, ADR-034). The version of a pending
  // edit is only moved by our own writes (PortIpam), never by a refetch — someone else's change must still conflict.
  const serverIp = base.device?.mgmtIp
  useEffect(() => {
    if (serverIp !== undefined) store.getState().syncDevice(deviceId, { mgmtIp: serverIp })
  }, [store, deviceId, serverIp])
  const [edit, setEdit] = useState<DeviceFields | null>(null)
  const current = base.input ? fieldsOf(base.input) : null
  const f = edit ?? current
  const set = (patch: Partial<DeviceFields>) => f && setEdit({ ...f, ...patch })
  const dirty = edit !== null && JSON.stringify(edit) !== JSON.stringify(current)
  const apply = () => {
    if (!base.input || !edit) return
    store.getState().dispatch(
      updateDevice(deviceId, {
        ...base.input,
        ...edit,
        mgmtInterfaceId: edit.mgmtInterfaceId || null,
        version: base.version,
      }),
    )
    setEdit(null)
  }
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono font-medium break-all">{card.hostname}</p>
          <p className="text-muted-foreground">
            {t(`devices.types.${card.type}`)}
            {card.draft && ` · ${t('editorDoc.unsaved')}`}
          </p>
        </div>
        {!card.draft && (
          <a
            href={`/o/${orgId}/devices/${deviceId}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink aria-hidden className="size-3.5" /> {t('panel.openPage')}
          </a>
        )}
      </div>
      <dl className="space-y-1">
        <Row label={t('devices.mgmtIp')} value={card.mgmtIp} mono />
        {base.device && (
          <>
            <Row
              label={t('devices.site')}
              value={`${base.device.siteCode} · ${base.device.siteName}`}
            />
            <Row
              label={t('panel.cluster')}
              value={
                base.device.clusterName &&
                `${base.device.clusterName} · ${t(`clusters.roles.${base.device.clusterRole ?? 'member'}`)}`
              }
            />
            <Row label={t('devices.serial')} value={base.device.serialNumber} mono />
          </>
        )}
      </dl>
      {f && (
        <Section title={t('panel.quickEdit')}>
          <fieldset disabled={!canEdit} className="space-y-2">
            <FormField label={t('devices.hostname')} help="hostname" required>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={f.hostname}
                  maxLength={253}
                  onChange={(e) => set({ hostname: e.target.value })}
                />
              )}
            </FormField>
            <FormField label={t('devices.type')} guide={t(`devices.typeInfo.${f.type}`)}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.type}
                  onChange={(e) => set({ type: e.target.value as DeviceFields['type'] })}
                >
                  {DEVICE_TYPE_GROUPS.map((g) => (
                    <optgroup key={g.group} label={t(`devices.typeGroups.${g.group}`)}>
                      {g.types.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`devices.types.${ty}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('devices.site')} help="site">
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.siteId}
                  onChange={(e) => set({ siteId: e.target.value })}
                >
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('devices.vendor')}>
                {(p) => (
                  <Input
                    {...p}
                    value={f.vendor}
                    maxLength={100}
                    onChange={(e) => set({ vendor: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('devices.model')}>
                {(p) => (
                  <Input
                    {...p}
                    value={f.model}
                    maxLength={100}
                    onChange={(e) => set({ model: e.target.value })}
                  />
                )}
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('devices.role')} help="role">
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={f.role}
                    onChange={(e) => set({ role: e.target.value as DeviceFields['role'] })}
                  >
                    {DEVICE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`devices.roleValues.${r}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label={t('devices.lifecycle')} help="lifecycle">
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={f.lifecycle}
                    onChange={(e) =>
                      set({ lifecycle: e.target.value as DeviceFields['lifecycle'] })
                    }
                  >
                    {LIFECYCLES.map((l) => (
                      <option key={l} value={l}>
                        {t(`devices.lifecycleValues.${l}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={f.managed}
                onChange={(e) => set({ managed: e.target.checked })}
              />
              <span>
                {t('devices.managed')}
                <span className="block text-xs text-muted-foreground">
                  {t('devices.managedHint')}
                </span>
              </span>
              <FieldHelp term="managed" />
            </label>
            {!card.draft && (
              <MgmtInterfaceField
                orgId={orgId}
                deviceId={deviceId}
                value={f.mgmtInterfaceId}
                onChange={(mgmtInterfaceId) => set({ mgmtInterfaceId })}
              />
            )}
            <FormField label={t('devices.notes')}>
              {(p) => (
                <Input
                  {...p}
                  value={f.notes}
                  maxLength={2000}
                  onChange={(e) => set({ notes: e.target.value })}
                />
              )}
            </FormField>
          </fieldset>
          <ApplyBar dirty={dirty} onApply={apply} onReset={() => setEdit(null)} />
        </Section>
      )}
      {base.loading && <p className="text-muted-foreground">{t('library.loading')}</p>}
      <Section title={t('panel.labelColor')}>
        {canEdit ? (
          <LabelColorPicker nodeIds={[nodeId]} current={node?.labelStyle?.color ?? ''} />
        ) : null}
      </Section>
      <PortsSection
        orgId={orgId}
        deviceId={deviceId}
        draft={card.draft === true}
        device={canEdit ? (base.device ?? undefined) : undefined}
      />
    </>
  )
}

/** Ports and what each one is cabled to (saved and drawn here). */
function PortsSection({
  orgId,
  deviceId,
  draft,
  device,
}: {
  orgId: string
  deviceId: string
  draft: boolean
  /** The saved device when the user may edit: ports open their IPAM editor (ADR-034). */
  device?: Device
}) {
  const { t } = useTranslation()
  const doc = useDoc((s) => s.doc)!
  const [open, setOpen] = useState<string | null>(null)
  const ips = useDeviceIps(orgId, device ? deviceId : '', Boolean(device))
  const ports = useInterfaces(orgId, draft ? '' : deviceId, !draft)
  const links = useLinks(orgId, draft ? '' : deviceId, !draft)
  const list = sortPorts(
    draft
      ? (doc.newPorts?.[deviceId] ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          kind: 'physical' as string,
          media: p.media as string,
          speed: p.speed,
        }))
      : (ports.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind as string,
          media: p.media as string,
          speed: p.speed,
        })),
  )
  const taken = takenPorts(doc, deviceId, links.data ?? [])
  const used = list.filter((p) => taken.has(p.id))
  return (
    <Section title={t('panel.ports', { used: used.length, total: list.length })}>
      {device && <p className="text-xs text-muted-foreground">{t('panel.portsHint')}</p>}
      {device &&
        ports.isSuccess &&
        !list.some((p) => p.kind === 'physical') &&
        device.type !== 'provider_cloud' && (
          <AddPorts
            orgId={orgId}
            device={{
              kind: 'device',
              id: device.id,
              name: device.hostname,
              type: device.type,
              draft: false,
            }}
            model={device.model}
          />
        )}
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t('panel.noPorts')}</p>
      ) : (
        // Focusable so the list scrolls by keyboard (WCAG scrollable region).
        <ul
          tabIndex={0}
          aria-label={t('panel.ports', { used: used.length, total: list.length })}
          className="max-h-60 space-y-0.5 overflow-y-auto rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          {list.map((p) => {
            const portIps = (ips.data ?? []).filter((x) => x.interfaceId === p.id)
            const iface = ports.data?.find((x) => x.id === p.id)
            const row = (
              <>
                <span className="w-28 shrink-0 truncate font-mono">{p.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {taken.get(p.id)
                    ? `→ ${taken.get(p.id)}`
                    : portIps[0]?.address || [p.media, p.speed].filter(Boolean).join(' ')}
                </span>
              </>
            )
            return (
              <li key={p.id}>
                {device && iface ? (
                  <button
                    type="button"
                    aria-expanded={open === p.id}
                    className="flex w-full gap-2 rounded-sm text-left hover:bg-muted"
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex gap-2">{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {/* The port editor sits under the list, not inside the scrolling list. */}
      {device &&
        (() => {
          const iface = open ? ports.data?.find((x) => x.id === open) : undefined
          if (!iface) return null
          return (
            <section aria-label={iface.name} className="space-y-1">
              <p className="font-mono font-medium">{iface.name}</p>
              <PortIpam
                orgId={orgId}
                device={device}
                iface={iface}
                ips={(ips.data ?? []).filter((x) => x.interfaceId === iface.id)}
              />
            </section>
          )
        })()}
    </Section>
  )
}

function GroupPanel({
  orgId,
  groupId,
  nodeId,
  canEdit,
}: {
  orgId: string
  groupId: string
  nodeId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const doc = useDoc((s) => s.doc)!
  const g = doc.groups[groupId]!
  const node = doc.view.nodes.find((n) => n.id === nodeId)
  return (
    <>
      <p className="font-medium">{g.name}</p>
      <p className="text-muted-foreground">{t(`devices.types.${g.kind as 'pc'}`)}</p>
      <a
        href={`/o/${orgId}/endpoint-groups/${groupId}`}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <ExternalLink aria-hidden className="size-3.5" /> {t('panel.openPage')}
      </a>
      {canEdit && (
        <Section title={t('panel.labelColor')}>
          <LabelColorPicker nodeIds={[nodeId]} current={node?.labelStyle?.color ?? ''} />
        </Section>
      )}
    </>
  )
}

function ManyPanel({ nodeIds, canEdit }: { nodeIds: string[]; canEdit: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      <p className="text-muted-foreground">{t('panel.manyHint')}</p>
      {canEdit && (
        <Section title={t('panel.labelColor')}>
          <LabelColorPicker nodeIds={nodeIds} current="" />
        </Section>
      )}
    </>
  )
}

type CableFields = Required<
  Pick<
    LinkInput,
    | 'status'
    | 'medium'
    | 'speed'
    | 'cableId'
    | 'fiberMode'
    | 'connector'
    | 'service'
    | 'provider'
    | 'circuitId'
    | 'bandwidth'
    | 'notes'
  >
> & { lengthM: string }

function cableFields(l: LinkInput): CableFields {
  return {
    status: l.status ?? 'up',
    medium: l.medium ?? '',
    speed: l.speed ?? '',
    cableId: l.cableId ?? '',
    fiberMode: l.fiberMode ?? '',
    connector: l.connector ?? '',
    service: l.service ?? '',
    provider: l.provider ?? '',
    circuitId: l.circuitId ?? '',
    bandwidth: l.bandwidth ?? '',
    notes: l.notes ?? '',
    lengthM: l.lengthM != null ? String(l.lengthM) : '',
  }
}

function CablePanel({
  orgId,
  linkId,
  canEdit,
  onEditCable,
}: {
  orgId: string
  linkId: string
  canEdit: boolean
  onEditCable: () => void
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const doc = useDoc((s) => s.doc)!
  const card = doc.links[linkId]!
  const pending = doc.newLinks[linkId] ?? doc.linkEdits[linkId]
  const saved = useLinks(orgId, pending ? '' : card.aId, !pending)
  const record = saved.data?.find((l) => l.id === linkId)
  const base: LinkInput | undefined =
    pending ??
    (record && {
      a: { kind: record.a.kind, id: record.a.id, interfaceId: record.a.interfaceId },
      b: { kind: record.b.kind, id: record.b.id, interfaceId: record.b.interfaceId },
      kind: record.kind,
      medium: record.medium,
      speed: record.speed,
      lengthM: record.lengthM,
      cableId: record.cableId,
      status: record.status,
      fiberMode: record.fiberMode,
      connector: record.connector,
      service: record.service,
      provider: record.provider,
      circuitId: record.circuitId,
      bandwidth: record.bandwidth,
      notes: record.notes,
    })
  const version = doc.linkEdits[linkId]?.version ?? record?.version ?? 0
  const [edit, setEdit] = useState<CableFields | null>(null)
  const current = base ? cableFields(base) : null
  const f = edit ?? current
  const set = (patch: Partial<CableFields>) => f && setEdit({ ...f, ...patch })
  const dirty = edit !== null && JSON.stringify(edit) !== JSON.stringify(current)
  const host = (id: string) => doc.devices[id]?.hostname ?? doc.groups[id]?.name ?? id
  const wanEnd = [card.aId, card.bId].some((id) => doc.devices[id]?.type === 'provider_cloud')
  const showWan = Boolean(
    f &&
    (f.service || f.provider || f.circuitId || wanEnd || ['dsl', 'cellular'].includes(card.kind)),
  )
  const apply = () => {
    if (!base || !edit) return
    const { lengthM, ...rest } = edit
    const n = Number(lengthM)
    store.getState().dispatch(
      updateLink(linkId, {
        ...base,
        ...rest,
        lengthM: lengthM.trim() === '' || !(n > 0) ? null : n,
        ...(card.kind === 'fiber' ? {} : { fiberMode: '', connector: '' }),
        version,
      }),
    )
    setEdit(null)
  }
  return (
    <>
      <p className="font-mono break-all">
        {[host(card.aId), card.aPort].filter(Boolean).join(' ')} ↔{' '}
        {[host(card.bId), card.bPort].filter(Boolean).join(' ')}
      </p>
      <div className="flex items-center gap-2">
        <span>{t(`links.kinds.${card.kind}`)}</span>
        {canEdit && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onEditCable}>
            <Pencil aria-hidden /> {t('panel.kindPorts')}
          </Button>
        )}
      </div>
      {!f && <p className="text-muted-foreground">{t('library.loading')}</p>}
      {f && (
        <Section title={t('panel.quickEdit')}>
          <fieldset disabled={!canEdit} className="space-y-2">
            <FormField label={t('links.status')} guide={t('guides.linkStatus')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.status}
                  onChange={(e) => set({ status: e.target.value as CableFields['status'] })}
                >
                  {LINK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`links.statuses.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('links.medium')} guide={t('guides.linkMedium')}>
                {(p) => (
                  <>
                    <Input
                      {...p}
                      list="panel-media"
                      value={f.medium}
                      maxLength={40}
                      onChange={(e) => set({ medium: e.target.value })}
                    />
                    <datalist id="panel-media">
                      {LINK_MEDIA[card.kind].map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </>
                )}
              </FormField>
              <FormField label={t('links.speed')} hint={t('links.speedHint')}>
                {(p) => (
                  <Input
                    {...p}
                    value={f.speed}
                    maxLength={20}
                    onChange={(e) => set({ speed: e.target.value })}
                  />
                )}
              </FormField>
            </div>
            {card.kind === 'fiber' && (
              <div className="grid grid-cols-2 gap-2">
                <FormField label={t('links.fiberMode')} help="fiber-mode">
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={f.fiberMode}
                      onChange={(e) =>
                        set({ fiberMode: e.target.value as CableFields['fiberMode'] })
                      }
                    >
                      {FIBER_MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(`links.fiberModes.${m || 'unknown'}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField label={t('links.connector')} help="fiber-mode">
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={f.connector}
                      onChange={(e) =>
                        set({ connector: e.target.value as CableFields['connector'] })
                      }
                    >
                      {CONNECTORS.map((c) => (
                        <option key={c} value={c}>
                          {c || t('links.fiberModes.unknown')}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('links.cableId')} guide={t('guides.cableId')}>
                {(p) => (
                  <Input
                    {...p}
                    className="font-mono"
                    value={f.cableId}
                    maxLength={64}
                    onChange={(e) => set({ cableId: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('links.length')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={f.lengthM}
                    onChange={(e) => set({ lengthM: e.target.value })}
                  />
                )}
              </FormField>
            </div>
            {showWan ? (
              <>
                <FormField
                  label={t('links.service')}
                  help="wan-service"
                  guide={t('guides.linkService')}
                >
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={f.service}
                      onChange={(e) => set({ service: e.target.value as CableFields['service'] })}
                    >
                      {LINK_SERVICES.map((v) => (
                        <option key={v} value={v}>
                          {t(`links.services.${v || 'none'}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label={t('links.provider')}>
                    {(p) => (
                      <Input
                        {...p}
                        value={f.provider}
                        maxLength={100}
                        onChange={(e) => set({ provider: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('links.bandwidth')}>
                    {(p) => (
                      <Input
                        {...p}
                        value={f.bandwidth}
                        maxLength={40}
                        onChange={(e) => set({ bandwidth: e.target.value })}
                      />
                    )}
                  </FormField>
                </div>
                <FormField label={t('links.circuitId')}>
                  {(p) => (
                    <Input
                      {...p}
                      className="font-mono"
                      value={f.circuitId}
                      maxLength={100}
                      onChange={(e) => set({ circuitId: e.target.value })}
                    />
                  )}
                </FormField>
              </>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => set({ service: 'internet_broadband' })}
                >
                  {t('panel.addWan')}
                </button>
              )
            )}
            <FormField label={t('links.notes')}>
              {(p) => (
                <Input
                  {...p}
                  value={f.notes}
                  maxLength={2000}
                  onChange={(e) => set({ notes: e.target.value })}
                />
              )}
            </FormField>
          </fieldset>
          <ApplyBar dirty={dirty} onApply={apply} onReset={() => setEdit(null)} />
        </Section>
      )}
    </>
  )
}

/** The management interface: its primary IP is the device's management IP (ADR-012). Saved interfaces only. */
function MgmtInterfaceField({
  orgId,
  deviceId,
  value,
  onChange,
}: {
  orgId: string
  deviceId: string
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const ports = useInterfaces(orgId, deviceId)
  return (
    <FormField
      label={t('panel.mgmtInterface')}
      help="mgmt-ip"
      guide={t('panel.mgmtInterfaceGuide')}
    >
      {(p) => (
        <NativeSelect {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('panel.noMgmtInterface')}</option>
          {sortPorts(ports.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/** A frame (bound to a site / location), a text or an arrow (P1-19). Each change is an undo step. */
function AnnotationPanel({
  orgId,
  annotationId,
  canEdit,
}: {
  orgId: string
  annotationId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const a = useDoc((s) => s.doc?.view.annotations.find((x) => x.id === annotationId))
  const sites = useSites(orgId, a?.kind === 'zone')
  const locations = useLocations(orgId, a?.siteId ?? '')
  if (!a) return null
  const set = (patch: Parameters<typeof updateAnnotation>[1], merge?: string) =>
    store.getState().dispatch(updateAnnotation(a.id, patch, merge && `${merge}:${a.id}`))
  return (
    <fieldset disabled={!canEdit} className="space-y-3">
      {a.kind === 'zone' && (
        <>
          <p className="text-muted-foreground">{t('frames.zoneHint')}</p>
          <FormField label={t('frames.site')} help="frame" guide={t('frames.siteGuide')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={a.siteId ?? ''}
                onChange={(e) =>
                  set({ siteId: e.target.value || undefined, locationId: undefined })
                }
              >
                <option value="">{t('frames.noSite')}</option>
                {(sites.data ?? []).map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.code} · {st.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {a.siteId && (locations.data ?? []).length > 0 && (
            <FormField label={t('frames.location')} help="location">
              {(p) => (
                <NativeSelect
                  {...p}
                  value={a.locationId ?? ''}
                  onChange={(e) => set({ locationId: e.target.value || undefined })}
                >
                  <option value="">{t('frames.wholeSite')}</option>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
        </>
      )}
      <FormField
        label={
          a.kind === 'zone'
            ? t('frames.title')
            : a.kind === 'arrow'
              ? t('frames.arrowLabel')
              : t('frames.text')
        }
        hint={a.kind === 'zone' ? t('frames.titleHint') : undefined}
      >
        {(p) =>
          a.kind === 'text' ? (
            <textarea
              {...p}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-input bg-transparent px-2 py-1"
              value={a.text ?? ''}
              onChange={(e) => set({ text: e.target.value }, 'text')}
            />
          ) : (
            <Input
              {...p}
              maxLength={200}
              value={a.text ?? ''}
              onChange={(e) => set({ text: e.target.value || undefined }, 'text')}
            />
          )
        }
      </FormField>
      <Section title={t('frames.color')}>
        <div role="radiogroup" aria-label={t('frames.color')} className="flex flex-wrap gap-1">
          {(['', ...LABEL_COLORS] as const).map((c) => (
            <button
              key={c || 'none'}
              type="button"
              role="radio"
              aria-checked={(a.color ?? '') === c}
              aria-label={t(`panel.colors.${c || 'none'}`)}
              title={t(`panel.colors.${c || 'none'}`)}
              onClick={() => set({ color: c || undefined })}
              className={cn(
                'size-6 rounded-sm border border-border-control',
                c ? `ntb-tag-${c}` : 'bg-card',
                (a.color ?? '') === c && 'ring-2 ring-primary',
              )}
            />
          ))}
        </div>
      </Section>
      {a.kind === 'text' && (
        <FormField label={t('frames.size')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={String(a.fontSize ?? 14)}
              onChange={(e) => set({ fontSize: Number(e.target.value) })}
            >
              {[12, 14, 16, 20, 24, 32].map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      {a.kind === 'arrow' && (
        <FormField label={t('frames.lineStyle')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={a.lineStyle ?? 'solid'}
              onChange={(e) => set({ lineStyle: e.target.value as 'solid' | 'dashed' })}
            >
              <option value="solid">{t('frames.solid')}</option>
              <option value="dashed">{t('frames.dashed')}</option>
            </NativeSelect>
          )}
        </FormField>
      )}
    </fieldset>
  )
}
