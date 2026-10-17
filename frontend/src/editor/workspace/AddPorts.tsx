import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCatalog, useInterfaceMutations, useTemplates } from '@/modules/inventory/devices'
import { matchCatalog } from '@/modules/inventory/import/plan'
import type { CableEnd } from './CableDialog'
import { describeGroup, guessPorts, type PortGroup } from './portGuess'

/**
 * A device with no port to plug a cable into (imported without a template): apply one of the organization's
 * templates of its type, or add the ports guessed from the model (editable). Written to the inventory right away,
 * like the IPAM edits of the panel (ADR-034) — the cable itself is still saved with the diagram.
 */
export function AddPorts({
  orgId,
  device,
  model,
}: {
  orgId: string
  device: CableEnd
  model: string
}) {
  const { t } = useTranslation()
  const templates = useTemplates(orgId)
  const { apply } = useInterfaceMutations(orgId, device.id)
  const catalog = useCatalog(orgId)
  const fromCatalog = matchCatalog(catalog.data ?? [], [model], device.type)
  const fitting = (templates.data ?? []).filter((x) => x.type === device.type)
  const [templateId, setTemplateId] = useState('')
  const [groups, setGroups] = useState<PortGroup[]>(() => guessPorts(model, device.type))
  const [editing, setEditing] = useState(false)

  const run = (what: string | PortGroup[] | { catalogId: string }) =>
    apply.mutate(what, {
      onSuccess: (added) =>
        toast.success(t('addPorts.added', { count: added ?? 0, name: device.name })),
      onError: (err) => toast.error(err.message),
    })
  const copyFromCatalog = () => fromCatalog && run({ catalogId: fromCatalog.id })
  const patch = (i: number, p: Partial<PortGroup>) =>
    setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, ...p } : x)))

  return (
    <div
      role="group"
      aria-label={t('addPorts.title', { name: device.name })}
      className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
    >
      <p className="font-medium">{t('addPorts.title', { name: device.name })}</p>
      <p className="text-muted-foreground">{t('addPorts.why')}</p>
      {fromCatalog && (
        <div className="space-y-1">
          <p>
            {t('addPorts.catalog', {
              model: `${fromCatalog.vendor} ${fromCatalog.model}`,
              count: fromCatalog.portCount,
            })}
            {!fromCatalog.verified && (
              <span className="ml-1 text-xs text-status-warning">
                {t('deviceImport.catalogUnverified')}
              </span>
            )}
          </p>
          <Button type="button" disabled={apply.isPending} onClick={copyFromCatalog}>
            {t('addPorts.useCatalog')}
          </Button>
        </div>
      )}
      {fitting.length > 0 && (
        <div className="flex gap-2">
          <NativeSelect
            aria-label={t('addPorts.template')}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t('addPorts.pickTemplate')}</option>
            {fitting.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {t('addPorts.portCount', { count: x.portCount })}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            disabled={!templateId || apply.isPending}
            onClick={() => run(templateId)}
          >
            {t('addPorts.apply')}
          </Button>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-muted-foreground">
          {model
            ? t('addPorts.guess', { model })
            : t('addPorts.guessType', { type: t(`devices.types.${device.type as 'modem'}`) })}
        </p>
        {!editing ? (
          <ul className="list-inside list-disc font-mono text-xs">
            {groups.map((g, i) => (
              <li key={i}>{describeGroup(g)}</li>
            ))}
          </ul>
        ) : (
          groups.map((g, i) => (
            <div key={i} className="grid grid-cols-[1fr_4rem_4rem_6rem_5rem] gap-1">
              <Input
                aria-label={t('addPorts.pattern')}
                className="font-mono text-xs"
                value={g.pattern}
                onChange={(e) => patch(i, { pattern: e.target.value })}
              />
              <Input
                aria-label={t('addPorts.start')}
                type="number"
                min={0}
                value={g.start}
                onChange={(e) => patch(i, { start: Number(e.target.value) })}
              />
              <Input
                aria-label={t('addPorts.count')}
                type="number"
                min={1}
                max={512}
                value={g.count}
                onChange={(e) => patch(i, { count: Number(e.target.value) })}
              />
              <NativeSelect
                aria-label={t('addPorts.media')}
                value={g.media ?? 'RJ45'}
                onChange={(e) => patch(i, { media: e.target.value as PortGroup['media'] })}
              >
                {['RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
              <Input
                aria-label={t('addPorts.speed')}
                value={g.speed ?? ''}
                onChange={(e) => patch(i, { speed: e.target.value })}
              />
            </div>
          ))
        )}
        {editing && <p className="text-xs text-muted-foreground">{t('addPorts.patternHint')}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={apply.isPending || groups.length === 0}
            onClick={() => run(groups)}
          >
            {t('addPorts.add')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing((x) => !x)}>
            {editing ? t('addPorts.doneEditing') : t('addPorts.edit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
