import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useEndpointGroup, type EndpointKind } from '@/modules/inventory/endpoints'
import { useIpamMutations, useSubnet, useSubnets } from '@/modules/ipam/ipam'
import { useSites } from '@/modules/sites/sites'
import { updateGroup } from '../doc/commands'
import { ENDPOINT_KINDS } from '../library/items'
import { useDoc, useDocStoreApi } from './context'
import { portRanges } from './wiring'

/**
 * An endpoint group on the diagram (ADR-036): name, kind, how many, site, IP range (picked, or made on the spot in a
 * subnet of the site — written to IPAM right away like the other IPAM edits of the panel, ADR-034), notes. The group
 * itself changes with the diagram (undo, Save). Below: the switch ports it is cabled to.
 */
export function EndpointPanel({
  orgId,
  groupId,
  canEdit,
}: {
  orgId: string
  groupId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const store = useDocStoreApi()
  const doc = useDoc((s) => s.doc)!
  const g = doc.groups[groupId]!
  const saved = useEndpointGroup(orgId, groupId, !g.draft)
  const sites = useSites(orgId)
  const subnets = useSubnets(orgId, '', '')
  const { saveRange } = useIpamMutations(orgId)
  const initial = {
    kind: g.kind as EndpointKind,
    name: g.name,
    siteId: g.siteId,
    subnetId: saved.data?.subnetId ?? '',
    ipRangeId: g.ipRangeId ?? '',
    expectedCount: g.expectedCount != null ? String(g.expectedCount) : '',
    notes: g.notes,
  }
  const [edit, setEdit] = useState<typeof initial | null>(null)
  const f = edit ?? initial
  const set = (patch: Partial<typeof initial>) => setEdit({ ...f, ...patch })
  const subnet = useSubnet(orgId, f.subnetId)
  const subnetOptions = (subnets.data ?? []).filter(
    (s) => s.siteId === null || s.siteId === f.siteId,
  )
  const [newRange, setNewRange] = useState<{ start: string; end: string } | null>(null)
  const count = f.expectedCount.trim() === '' ? null : Number(f.expectedCount)
  const badCount = count !== null && (!Number.isInteger(count) || count < 0 || count > 100000)
  const dirty = edit !== null && JSON.stringify(edit) !== JSON.stringify(initial)

  const apply = () => {
    if (!edit || badCount || !f.name.trim()) return
    const range = subnet.data?.ranges.find((r) => r.id === f.ipRangeId)
    const version = doc.groupEdits?.[groupId]?.version ?? saved.data?.version ?? 0
    store.getState().dispatch(
      updateGroup(
        groupId,
        {
          kind: f.kind,
          name: f.name.trim(),
          siteId: f.siteId,
          ipRangeId: f.ipRangeId || null,
          expectedCount: count,
          notes: f.notes,
        },
        version,
        range ? `${range.startIp}–${range.endIp}` : f.ipRangeId ? g.range : '',
      ),
    )
    setEdit(null)
  }

  const createRange = () => {
    if (!newRange || !f.subnetId) return
    saveRange.mutate(
      {
        subnetId: f.subnetId,
        body: {
          startIp: newRange.start.trim(),
          endIp: newRange.end.trim(),
          kind: 'static',
          purpose: f.name.trim(),
        },
      },
      {
        onSuccess: (r) => {
          if (!r) return
          toast.success(t('endpointPanel.rangeCreated', { range: `${r.startIp}–${r.endIp}` }))
          setNewRange(null)
          set({ ipRangeId: r.id })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  // The switch ports the group is cabled to, per device ("SW-POE-01: Gi1/0/1–24 (24)").
  const ports = new Map<string, string[]>()
  for (const l of Object.values(doc.links)) {
    const other =
      l.aId === groupId
        ? { id: l.bId, port: l.bPort }
        : l.bId === groupId
          ? { id: l.aId, port: l.aPort }
          : null
    if (!other) continue
    ports.set(other.id, [...(ports.get(other.id) ?? []), other.port ?? ''])
  }

  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{g.name}</p>
          <p className="text-muted-foreground">
            {t('endpointPanel.subtitle', { kind: t(`devices.types.${g.kind}`) })}
          </p>
        </div>
        {!g.draft && (
          <a
            href={`/o/${orgId}/endpoint-groups/${groupId}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink aria-hidden className="size-3.5" /> {t('panel.openPage')}
          </a>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('endpointPanel.guide')}</p>
      <fieldset disabled={!canEdit} className="space-y-3">
        <FormField label={t('endpointNew.name')} required>
          {(p) => (
            <Input
              {...p}
              maxLength={100}
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label={t('endpointNew.kind')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={f.kind}
                onChange={(e) => set({ kind: e.target.value as EndpointKind })}
              >
                {[...new Set([...ENDPOINT_KINDS, f.kind])].map((k) => (
                  <option key={k} value={k}>
                    {t(`devices.types.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            label={t('endpointNew.count')}
            error={badCount ? t('endpointNew.badCount') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                placeholder="24"
                value={f.expectedCount}
                onChange={(e) => set({ expectedCount: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <FormField label={t('devices.site')} help="site">
          {(p) => (
            <NativeSelect
              {...p}
              value={f.siteId}
              onChange={(e) => set({ siteId: e.target.value, subnetId: '', ipRangeId: '' })}
            >
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          label={t('endpoints.subnet')}
          help="subnet"
          guide={t('endpointPanel.rangeGuide')}
        >
          {(p) => (
            <NativeSelect
              {...p}
              value={f.subnetId}
              onChange={(e) => {
                set({ subnetId: e.target.value, ipRangeId: '' })
                setNewRange(null)
              }}
            >
              <option value="">{t('endpoints.noRange')}</option>
              {subnetOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.cidr}
                  {s.description ? ` · ${s.description}` : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {f.subnetId && (
          <FormField label={t('endpoints.range')} help="ip-range">
            {(p) => (
              <div className="space-y-1">
                <NativeSelect
                  {...p}
                  value={newRange ? '__new' : f.ipRangeId}
                  onChange={(e) => {
                    if (e.target.value === '__new') setNewRange({ start: '', end: '' })
                    else {
                      setNewRange(null)
                      set({ ipRangeId: e.target.value })
                    }
                  }}
                >
                  <option value="">{t('endpoints.chooseRange')}</option>
                  {(subnet.data?.ranges ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.startIp} – {r.endIp}
                      {r.purpose ? ` · ${r.purpose}` : ''}
                    </option>
                  ))}
                  <option value="__new">{t('endpointPanel.newRange')}</option>
                </NativeSelect>
                {newRange && (
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={t('endpointPanel.rangeStart')}
                      className="font-mono"
                      placeholder={t('endpointPanel.rangeStart')}
                      value={newRange.start}
                      onChange={(e) => setNewRange({ ...newRange, start: e.target.value })}
                    />
                    <span>–</span>
                    <Input
                      aria-label={t('endpointPanel.rangeEnd')}
                      className="font-mono"
                      placeholder={t('endpointPanel.rangeEnd')}
                      value={newRange.end}
                      onChange={(e) => setNewRange({ ...newRange, end: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!newRange.start || !newRange.end || saveRange.isPending}
                      onClick={createRange}
                    >
                      {t('endpointPanel.createRange')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </FormField>
        )}
        <FormField label={t('endpoints.notes')}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={2000}
              value={f.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </FormField>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" disabled={!dirty || badCount || !f.name.trim()} onClick={apply}>
              {t('panel.apply')}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                {t('panel.reset')}
              </Button>
            )}
          </div>
        )}
      </fieldset>
      <section className="space-y-1">
        <h3 className="text-label font-medium text-muted-foreground">{t('endpointPanel.ports')}</h3>
        {ports.size === 0 ? (
          <p className="text-sm text-muted-foreground">{t('endpointPanel.noPorts')}</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {[...ports].map(([id, names]) => (
              <li key={id}>
                <span className="font-mono">{doc.devices[id]?.hostname ?? '?'}</span>:{' '}
                <span className="font-mono">
                  {portRanges(names.filter(Boolean)) || t('endpointPanel.noPortYet')}
                </span>{' '}
                <span className="text-muted-foreground">({names.length})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
