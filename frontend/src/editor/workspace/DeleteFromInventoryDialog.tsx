import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDeleteImpact } from '../doc/api'
import type { DocState, LinkCard } from '../doc/types'

export interface DeleteTarget {
  /** Devices to delete (saved or created in this editor). */
  deviceIds: string[]
  /** Cables to delete on their own. */
  linkIds: string[]
  /** Locked devices left out. */
  skippedLocked: number
}

/**
 * Delete from the inventory (Shift+Delete or the menu, ADR-033): always confirmed, listing everything that goes —
 * every cable of the devices (also those not drawn here), the other diagrams showing them, clusters losing a member,
 * IPs released. Nothing is sent before the diagram is saved, and undo brings it back until then.
 */
export function DeleteFromInventoryDialog({
  orgId,
  diagramId,
  doc,
  target,
  onConfirm,
  onClose,
}: {
  orgId: string
  diagramId: string
  doc: DocState
  target: DeleteTarget
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const saved = target.deviceIds.filter((id) => !doc.newDevices[id])
  const impact = useDeleteImpact(orgId, saved)
  const host = (id: string) => doc.devices[id]?.hostname ?? id
  const cableLabel = (l: { a: string; aPort: string; b: string; bPort: string; kind: string }) =>
    `${[l.a, l.aPort].filter(Boolean).join(' ')} ↔ ${[l.b, l.bPort].filter(Boolean).join(' ')} · ${t(`links.kinds.${l.kind as 'ethernet'}`)}`
  // Cables: the ones picked, the devices' cables known here, and those the server reports (not drawn here).
  const cables = new Map<string, { label: string; elsewhere: boolean }>()
  const fromCard = (l: LinkCard) =>
    cableLabel({ a: host(l.aId), aPort: l.aPort, b: host(l.bId), bPort: l.bPort, kind: l.kind })
  const devs = new Set(target.deviceIds)
  for (const l of Object.values(doc.links))
    if (target.linkIds.includes(l.id) || devs.has(l.aId) || devs.has(l.bId))
      cables.set(l.id, { label: fromCard(l), elsewhere: false })
  for (const l of impact.data?.links ?? [])
    if (!cables.has(l.id))
      cables.set(l.id, {
        label: cableLabel({
          a: l.a.name,
          aPort: l.a.interfaceName,
          b: l.b.name,
          bPort: l.b.interfaceName,
          kind: l.kind,
        }),
        elsewhere: true,
      })
  const others = (impact.data?.diagrams ?? []).filter((d) => d.id !== diagramId)
  const clusters = (impact.data?.devices ?? []).filter((d) => d.clusterName)
  const ips = (impact.data?.devices ?? []).reduce((n, d) => n + d.ipCount, 0)
  const title =
    target.deviceIds.length > 0
      ? t('editorDelete.titleDevices', { count: target.deviceIds.length })
      : t('editorDelete.titleCables', { count: target.linkIds.length })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={title} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-4 text-destructive" /> {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">{t('editorDelete.body')}</p>
        {target.deviceIds.length > 0 && (
          <section aria-label={t('editorDelete.devices')}>
            <h3 className="font-medium">{t('editorDelete.devices')}</h3>
            <ul className="list-disc pl-5">
              {target.deviceIds.map((id) => (
                <li key={id} className="font-mono">
                  {host(id)}
                  {doc.newDevices[id] && (
                    <span className="ml-1 font-sans text-muted-foreground">
                      ({t('editorDoc.unsaved')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {impact.isPending && saved.length > 0 ? (
          <p className="text-muted-foreground">{t('editorDelete.checking')}</p>
        ) : (
          <>
            {cables.size > 0 && (
              <section aria-label={t('editorDelete.cables', { count: cables.size })}>
                <h3 className="font-medium">{t('editorDelete.cables', { count: cables.size })}</h3>
                <ul className="list-disc pl-5">
                  {[...cables.entries()].map(([id, c]) => (
                    <li key={id}>
                      {c.label}
                      {c.elsewhere && (
                        <span className="ml-1 text-muted-foreground">
                          ({t('editorDelete.notDrawn')})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {others.length > 0 && (
              <p>
                {t('editorDelete.otherDiagrams', {
                  names: others.map((d) => d.name).join(', '),
                })}
              </p>
            )}
            {clusters.map((d) => (
              <p key={d.id}>
                {t('editorDelete.cluster', {
                  host: d.hostname,
                  cluster: d.clusterName,
                  count: d.clusterMembersLeft,
                })}
              </p>
            ))}
            {ips > 0 && <p>{t('editorDelete.ips', { count: ips })}</p>}
          </>
        )}
        {target.skippedLocked > 0 && (
          <p className="text-status-warning">
            {t('editorDelete.lockedSkipped', { count: target.skippedLocked })}
          </p>
        )}
        {impact.isError && <p className="text-destructive">{impact.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={saved.length > 0 && !impact.data}
            onClick={onConfirm}
          >
            {t('editorDelete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
