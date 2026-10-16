import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { TechText } from '@/components/TechText'
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
import { atLeast, useOrgAccess } from '@/modules/sites/access'
import { useBusinessUnits, useSites } from '@/modules/sites/sites'
import {
  CLUSTER_KINDS,
  useCluster,
  useClusterMutations,
  useClusters,
  type Cluster,
  type ClusterKind,
} from './devices'

function ClusterDialog({
  orgId,
  cluster,
  onClose,
}: {
  orgId: string
  cluster?: Cluster
  onClose: () => void
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
    siteId: cluster?.siteId ?? '',
    businessUnitId: cluster?.businessUnitId ?? '',
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
        onSuccess: () => {
          toast.success(t('clusters.saved'))
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
            <FormField label={t('clusters.kind')}>
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

/** Device clusters (P1-09b, ADR-027). ?id= opens one cluster. */
export function ClustersPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const clusters = useClusters(orgId)
  const { remove } = useClusterMutations(orgId)
  const access = useOrgAccess(orgId)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Cluster | null>(null)
  const openId = params.get('id')
  const open = clusters.data?.find((c) => c.id === openId)
  useBreadcrumbs([{ label: t('clusters.title') }])

  return (
    <div className="max-w-5xl space-y-3 p-4">
      <PageHeader
        title={t('clusters.title')}
        actions={
          access.canAddSites && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('clusters.add')}
            </Button>
          )
        }
      />
      <p className="text-muted-foreground">{t('clusters.subtitle')}</p>
      {clusters.isPending ? (
        <Skeleton className="h-24" />
      ) : clusters.isError ? (
        <p role="alert" className="text-destructive">
          {clusters.error.message}
        </p>
      ) : clusters.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<Boxes />} title={t('clusters.empty')} />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {clusters.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <button
                    type="button"
                    className="font-medium hover:text-primary hover:underline"
                    onClick={() => setParams({ id: c.id }, { replace: true })}
                  >
                    {c.name}
                  </button>
                  <span className="text-muted-foreground">
                    {t('clusters.badge', {
                      kind: t(`clusters.kinds.${c.kind}`),
                      count: c.memberCount,
                    })}
                  </span>
                  {c.mgmtIp && <TechText value={c.mgmtIp} label={t('clusters.mgmtIp')} />}
                </div>
                <div className="truncate text-muted-foreground">
                  {c.siteCode} · {c.partnerCode} › {c.unitCode}
                  {c.hostname && ` · ${c.hostname}`}
                  {c.memberHostnames && ` · ${c.memberHostnames}`}
                </div>
              </div>
              {atLeast(c.access, 'edit') && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('clusters.edit')} ${c.name}`}
                    onClick={() => setParams({ id: c.id }, { replace: true })}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('clusters.delete')} ${c.name}`}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {(creating || open) && (
        <ClusterDialog
          key={open?.id ?? 'new'}
          orgId={orgId}
          cluster={creating ? undefined : open}
          onClose={() => {
            setCreating(false)
            setParams({}, { replace: true })
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('clusters.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('clusters.deleteBody')}
        confirmLabel={t('clusters.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
