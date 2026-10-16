import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { toast } from 'sonner'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { atLeast } from '@/modules/sites/access'
import { useBusinessUnits, useSites } from '@/modules/sites/sites'
import {
  CLUSTER_KINDS,
  useCluster,
  useClusterMutations,
  type Cluster,
  type ClusterDetail,
  type ClusterKind,
} from './devices'

/** Create or edit a device cluster (ADR-027); opened from a device page. */
export function ClusterDialog({
  orgId,
  cluster,
  defaultSiteId,
  defaultUnitId,
  onClose,
  onSaved,
}: {
  orgId: string
  cluster?: Cluster
  defaultSiteId?: string
  defaultUnitId?: string
  onClose: () => void
  onSaved?: (c: ClusterDetail) => void
}) {
  const { t } = useTranslation()
  const { save } = useClusterMutations(orgId)
  const detail = useCluster(orgId, cluster?.id ?? null)
  const sites = useSites(orgId)
  const units = useBusinessUnits(orgId)
  const [f, setF] = useState({
    kind: (cluster?.kind ?? 'ha_active_passive') as ClusterKind,
    name: cluster?.name ?? '',
    hostname: cluster?.hostname ?? '',
    mgmtIp: cluster?.mgmtIp ?? '',
    notes: cluster?.notes ?? '',
    siteId: cluster?.siteId ?? defaultSiteId ?? '',
    businessUnitId: cluster?.businessUnitId ?? defaultUnitId ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const site = sites.data?.find((s) => s.id === f.siteId)
  const shared = site !== undefined && site.businessUnitId === null
  const hasMembers = (cluster?.memberCount ?? 0) > 0

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        cluster,
        body: {
          kind: f.kind,
          name: f.name.trim(),
          hostname: f.hostname.trim(),
          mgmtIp: f.mgmtIp.trim() || null,
          notes: f.notes,
          siteId: f.siteId,
          businessUnitId: shared ? f.businessUnitId || null : null,
        },
      },
      {
        onSuccess: (saved) => {
          toast.success(t('clusters.saved'))
          onSaved?.(saved)
          onClose()
        },
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={cluster ? t('clusters.edit') : t('clusters.add')}
        >
          <DialogHeader>
            <DialogTitle>{cluster ? t('clusters.edit') : t('clusters.add')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('clusters.name')} required>
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={100}
                  value={f.name}
                  onChange={set('name')}
                />
              )}
            </FormField>
            <FormField label={t('clusters.kind')} hint={t(`hints.clusterKinds.${f.kind}`)}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value as ClusterKind })}
                >
                  {CLUSTER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`clusters.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('clusters.hostname')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={253}
                  value={f.hostname}
                  onChange={set('hostname')}
                  className="font-mono"
                />
              )}
            </FormField>
            <FormField label={t('clusters.mgmtIp')} hint={t('clusters.mgmtHint')}>
              {(p) => (
                <Input {...p} value={f.mgmtIp} onChange={set('mgmtIp')} className="font-mono" />
              )}
            </FormField>
            <FormField label={t('devices.site')} required>
              {(p) => (
                <NativeSelect
                  {...p}
                  required
                  disabled={hasMembers}
                  value={f.siteId}
                  onChange={(e) => setF({ ...f, siteId: e.target.value, businessUnitId: '' })}
                >
                  <option value="">{t('devices.chooseSite')}</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {shared && (
              <FormField label={t('devices.unit')} required hint={t('devices.sharedSiteUnit')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    required
                    disabled={hasMembers}
                    value={f.businessUnitId}
                    onChange={set('businessUnitId')}
                  >
                    <option value="">{t('devices.chooseUnit')}</option>
                    {(units.data ?? [])
                      .filter((u) => atLeast(u.access, 'edit') || u.id === cluster?.businessUnitId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.partnerCode} › {u.code} · {u.name}
                        </option>
                      ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
          </div>
          <FormField label={t('devices.notes')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
          {cluster && (
            <section aria-label={t('clusters.members')} className="space-y-1">
              <h3 className="text-form font-medium">{t('clusters.members')}</h3>
              {detail.isPending ? (
                <Skeleton className="h-10" />
              ) : (detail.data?.members ?? []).length === 0 ? (
                <p className="text-muted-foreground">{t('clusters.noMembers')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {(detail.data?.members ?? []).map((mb) => (
                    <li key={mb.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-8 text-muted-foreground" data-numeric>
                        {mb.memberNo ?? '—'}
                      </span>
                      <Link
                        to={`/o/${orgId}/devices/${mb.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {mb.hostname}
                      </Link>
                      <span className="text-muted-foreground">
                        {mb.role ? t(`clusters.roles.${mb.role}`) : ''} · {mb.model || '—'} ·{' '}
                        {mb.serialNumber || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-label text-muted-foreground">{t('clusters.membersHint')}</p>
            </section>
          )}
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !f.siteId}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
