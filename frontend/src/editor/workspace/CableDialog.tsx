import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useInterfaces } from '@/modules/inventory/devices'
import { AddPorts } from './AddPorts'
import {
  LINK_KINDS,
  LINK_MEDIA,
  LINK_STATUSES,
  portFits,
  sharesPort,
  useLinks,
  type LinkInput,
  type LinkKind,
  type LinkStatus,
} from '@/modules/inventory/links'
import type { PortNames } from '../doc/commands'
import type { DocState } from '../doc/types'
import { sortPorts, suggestKind, takenPorts } from './wiring'

export interface CableEnd {
  kind: 'device' | 'endpoint_group'
  id: string
  name: string
  /** Device type (empty for a group). */
  type: string
  /** Created in this editor and not saved: no ports yet. */
  draft: boolean
  clusterId?: string | null
}

/** What the port list needs from a saved interface or a template port of a device not saved yet. */
interface PortOption {
  id: string
  name: string
  kind: string
  media: string
  speed: string
}

export interface CableValue {
  kind: LinkKind
  aPort: string
  bPort: string
  medium: string
  status: LinkStatus
}

/**
 * Draw or edit a cable (P1-17, SRS §6.2, ADR-033): the kind, then the port at each end. Ports that are taken or that
 * this kind of cable cannot plug into are greyed out; a port may stay empty and be assigned later (ADR-013).
 */
export function CableDialog({
  orgId,
  doc,
  a,
  b,
  initial,
  self,
  onSave,
  onClose,
}: {
  orgId: string
  doc: DocState
  a: CableEnd
  b: CableEnd
  initial?: CableValue
  /** The cable being edited (its own ports are not "taken"). */
  self?: string
  onSave: (input: LinkInput, ports: PortNames) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [v, setV] = useState<CableValue>(
    initial ?? {
      kind: suggestKind(
        a.type,
        b.type,
        '',
        '',
        Boolean(a.clusterId && a.clusterId === b.clusterId),
      ),
      aPort: '',
      bPort: '',
      medium: '',
      status: 'up',
    },
  )
  // Once the user picks the kind, choosing ports no longer re-suggests it.
  const [kindTouched, setKindTouched] = useState(Boolean(initial))
  const portsA = usePorts(orgId, doc, a, v.kind, self)
  const portsB = usePorts(orgId, doc, b, v.kind, self)
  const noPortReason = (e: CableEnd): string | null => {
    if (e.kind === 'endpoint_group') return t('cable.noPortGroup')
    if (e.type === 'provider_cloud') return t('cable.noPortCloud')
    if (v.kind === 'power' && e.type !== 'ups' && e.type !== 'pdu') return t('cable.noPortPower')
    if (e.draft && !(doc.newPorts?.[e.id]?.length ?? 0)) return t('cable.noPortDraft')
    return null
  }
  const title = self ? t('cable.editTitle') : t('cable.title')
  const endField = (
    e: CableEnd,
    ports: ReturnType<typeof usePorts>,
    value: string,
    set: (port: string) => void,
    withGuide = false,
  ) => {
    const reason = noPortReason(e)
    return (
      <FormField
        label={t('cable.portOf', { name: e.name })}
        help="interface"
        hint={reason ?? undefined}
        guide={reason || !withGuide ? undefined : t('guides.linkPort')}
      >
        {(p) => (
          <NativeSelect
            {...p}
            value={reason ? '' : value}
            disabled={reason !== null}
            onChange={(ev) => set(ev.target.value)}
          >
            <option value="">{t('cable.noPort')}</option>
            {orderPorts(ports, v.kind).map((port) => {
              const busy = ports.taken.get(port.id)
              const fits = portFits(v.kind, port.kind, port.media)
              const free = busy === undefined || sharesPort(v.kind, port.media)
              return (
                <option
                  key={port.id}
                  value={port.id}
                  disabled={(!fits || !free) && port.id !== value}
                >
                  {port.name}
                  {port.media ? ` · ${port.media}` : ''}
                  {port.speed ? ` ${port.speed}` : ''}
                  {!fits
                    ? ` (${t('cable.unfit')})`
                    : !free
                      ? ` (${t('cable.takenBy', { name: busy })})`
                      : ''}
                </option>
              )
            })}
          </NativeSelect>
        )}
      </FormField>
    )
  }
  /** A saved device with no port a cable can take (imported without a template): offer to add them here. */
  const needsPorts = (e: CableEnd, ports: ReturnType<typeof usePorts>) =>
    e.kind === 'device' &&
    !e.draft &&
    noPortReason(e) === null &&
    ports.loaded &&
    !ports.list.some((p) => p.kind === 'physical')
  const nameOf = (list: ReturnType<typeof usePorts>['list'], id: string) =>
    list.find((p) => p.id === id)?.name ?? ''
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={title} className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const aPort = noPortReason(a) ? '' : v.aPort
            const bPort = noPortReason(b) ? '' : v.bPort
            onSave(
              {
                a: { kind: a.kind, id: a.id, interfaceId: aPort || null },
                b: { kind: b.kind, id: b.id, interfaceId: bPort || null },
                kind: v.kind,
                medium: v.medium.trim(),
                status: v.status,
              },
              { aPort: nameOf(portsA.list, aPort), bPort: nameOf(portsB.list, bPort) },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="font-mono">
            {a.name} ↔ {b.name}
          </p>
          <FormField label={t('links.kind')} help="link-kind" hint={t(`hints.linkKinds.${v.kind}`)}>
            {(p) => (
              <NativeSelect
                {...p}
                value={v.kind}
                onChange={(e) => {
                  const kind = e.target.value as LinkKind
                  setKindTouched(true)
                  // Ports that no longer fit the new kind are cleared.
                  const keep = (list: ReturnType<typeof usePorts>['list'], id: string) => {
                    const port = list.find((x) => x.id === id)
                    return port && portFits(kind, port.kind, port.media) ? id : ''
                  }
                  setV({
                    ...v,
                    kind,
                    aPort: keep(portsA.list, v.aPort),
                    bPort: keep(portsB.list, v.bPort),
                    medium: '',
                  })
                }}
              >
                {LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`links.kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {[
            [a, portsA],
            [b, portsB],
          ].map(([e, ports]) =>
            needsPorts(e as CableEnd, ports as ReturnType<typeof usePorts>) ? (
              <AddPorts
                key={(e as CableEnd).id}
                orgId={orgId}
                device={e as CableEnd}
                model={doc.devices[(e as CableEnd).id]?.model ?? ''}
              />
            ) : null,
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {endField(
              a,
              portsA,
              v.aPort,
              (aPort) => {
                const port = portsA.list.find((x) => x.id === aPort)
                // The first port picked on a fresh cable refines the suggested kind (e.g. SFP+ on both ends → fibre).
                setV((cur) => ({ ...cur, aPort, kind: refine(cur, port?.media, undefined) }))
              },
              true,
            )}
            {endField(b, portsB, v.bPort, (bPort) => {
              const port = portsB.list.find((x) => x.id === bPort)
              setV((cur) => ({ ...cur, bPort, kind: refine(cur, undefined, port?.media) }))
            })}
          </div>
          <FormField label={t('links.medium')} guide={t('guides.linkMedium')}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list="cable-media"
                  maxLength={40}
                  value={v.medium}
                  onChange={(e) => setV({ ...v, medium: e.target.value })}
                />
                <datalist id="cable-media">
                  {LINK_MEDIA[v.kind].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          <FormField label={t('links.status')} guide={t('guides.linkStatus')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={v.status}
                onChange={(e) => setV({ ...v, status: e.target.value as LinkStatus })}
              >
                {LINK_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {t(`links.statuses.${st}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <p className="text-xs text-muted-foreground">{t('cable.later')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{self ? t('common.save') : t('cable.connect')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  /** Re-suggest the kind from the chosen ports, unless the user picked the kind by hand. */
  function refine(cur: CableValue, aMedia?: string, bMedia?: string): LinkKind {
    if (kindTouched) return cur.kind
    const ma = aMedia ?? portsA.list.find((x) => x.id === cur.aPort)?.media ?? ''
    const mb = bMedia ?? portsB.list.find((x) => x.id === cur.bPort)?.media ?? ''
    return suggestKind(a.type, b.type, ma, mb, Boolean(a.clusterId && a.clusterId === b.clusterId))
  }
}

/** Free ports that fit first, then taken ones, then those this kind cannot plug into; LAG never shown. */
function orderPorts(ports: { list: PortOption[]; taken: Map<string, string> }, kind: LinkKind) {
  const rank = (p: PortOption) => {
    if (!portFits(kind, p.kind, p.media)) return 2
    return ports.taken.has(p.id) && !sharesPort(kind, p.media) ? 1 : 0
  }
  return ports.list
    .filter((p) => p.kind !== 'lag')
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p)
}

function usePorts(orgId: string, doc: DocState, e: CableEnd, kind: LinkKind, self?: string) {
  const enabled = e.kind === 'device' && !e.draft
  const ports = useInterfaces(orgId, enabled ? e.id : '', enabled)
  const links = useLinks(orgId, enabled ? e.id : '', enabled)
  // A device placed in this editor offers the ports its template will generate (temp ids, mapped at save).
  const raw: PortOption[] = e.draft ? (doc.newPorts?.[e.id] ?? []) : (ports.data ?? [])
  const list = sortPorts(raw)
  return {
    list,
    taken: takenPorts(doc, e.id, links.data ?? [], self),
    kind,
    loaded: e.draft || ports.isSuccess,
  }
}
