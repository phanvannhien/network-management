import { Boxes } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { atLeast } from '@/modules/sites/access'
import { ClusterDialog } from './ClusterDialog'
import {
  canJoinCluster,
  CLUSTER_ROLES,
  deviceToInput,
  useCluster,
  useClusterMutations,
  useClusters,
  useSaveDevice,
  type ClusterRole,
  type Device,
} from './devices'

/** Join an existing cluster of the device's site / unit, or create one first (ADR-027). */
function JoinClusterDialog({
  orgId,
  device,
  onClose,
}: {
  orgId: string
  device: Device
  onClose: () => void
}) {
  const { t } = useTranslation()
  const clusters = useClusters(orgId)
  const save = useSaveDevice(orgId)
  const [creating, setCreating] = useState(false)
  const [clusterId, setClusterId] = useState('')
  const [role, setRole] = useState<ClusterRole>('primary')
  const [no, setNo] = useState('1')
  const candidates = (clusters.data ?? []).filter(
    (c) =>
      c.siteId === device.siteId && canJoinCluster(c, device.type) && atLeast(c.access, 'edit'),
  )
  const join = (id: string) =>
    save.mutate(
      {
        device,
        body: {
          ...deviceToInput(device),
          clusterId: id,
          clusterRole: role,
          clusterMemberNo: no ? Number(no) : null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('clusters.joined'))
          onClose()
        },
      },
    )
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (clusterId) join(clusterId)
  }
  if (creating)
    return (
      <ClusterDialog
        orgId={orgId}
        defaultSiteId={device.siteId}
        onClose={() => setCreating(false)}
        onSaved={(c) => join(c.id)}
      />
    )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4" aria-label={t('clusters.join')}>
          <DialogHeader>
            <DialogTitle>{t('clusters.joinTitle', { name: device.hostname })}</DialogTitle>
            <DialogDescription>{t('clusters.deviceHint')}</DialogDescription>
          </DialogHeader>
          <FormField label={t('clusters.cluster')} help="cluster">
            {(p) => (
              <NativeSelect {...p} value={clusterId} onChange={(e) => setClusterId(e.target.value)}>
                <option value="">{t('clusters.chooseCluster')}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({t(`clusters.kinds.${c.kind}`)} · {c.memberCount})
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('clusters.role')} guide={t('guides.clusterRole')} help="ha">
              {(p) => (
                <NativeSelect
                  {...p}
                  value={role}
                  onChange={(e) => setRole(e.target.value as ClusterRole)}
                >
                  {CLUSTER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`clusters.roles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('clusters.memberNo')} guide={t('guides.memberNo')} help="member-no">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={99}
                  value={no}
                  onChange={(e) => setNo(e.target.value)}
                />
              )}
            </FormField>
          </div>
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              {t('clusters.createAndJoin')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!clusterId || save.isPending}>
                {t('clusters.join')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The device's cluster on its page (ADR-027): members, shared hostname / IP; join, edit, leave. Leaving as the last
 * member removes the empty cluster.
 */
export function DeviceClusterCard({
  orgId,
  device,
  canEdit,
}: {
  orgId: string
  device: Device
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const cluster = useCluster(orgId, device.clusterId)
  const save = useSaveDevice(orgId)
  const { remove } = useClusterMutations(orgId)
  const [joining, setJoining] = useState(false)
  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const c = cluster.data
  const last = (c?.memberCount ?? 0) <= 1

  const leave = () =>
    save.mutate(
      {
        device,
        body: {
          ...deviceToInput(device),
          clusterId: null,
          clusterRole: null,
          clusterMemberNo: null,
        },
      },
      {
        onSuccess: () => {
          if (last && c) remove.mutate(c.id)
          toast.success(t('clusters.left'))
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => setLeaving(false),
      },
    )

  return (
    <section
      aria-label={t('clusters.cluster')}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Boxes aria-hidden className="size-4 text-muted-foreground" /> {t('clusters.cluster')}
        </h2>
        {canEdit && (
          <div className="flex gap-2">
            {device.clusterId ? (
              <>
                {c && atLeast(c.access, 'edit') && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    {t('clusters.edit')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setLeaving(true)}>
                  {t('clusters.leave')}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setJoining(true)}>
                {t('clusters.join')}
              </Button>
            )}
          </div>
        )}
      </div>
      {!device.clusterId ? (
        <p className="text-muted-foreground">{t('clusters.notInCluster')}</p>
      ) : !c ? (
        <p className="text-muted-foreground">…</p>
      ) : (
        <>
          <p>
            <span className="font-medium">{c.name}</span>{' '}
            <span className="text-muted-foreground">
              {t('clusters.badge', { kind: t(`clusters.kinds.${c.kind}`), count: c.memberCount })}
              {c.hostname && ` · ${c.hostname}`}
            </span>{' '}
            {c.mgmtIp && <TechText value={c.mgmtIp} label={t('clusters.mgmtIp')} />}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {c.members.map((mb) => (
              <li key={mb.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-8 text-muted-foreground" data-numeric>
                  {mb.memberNo ?? '—'}
                </span>
                {mb.id === device.id ? (
                  <span className="font-medium">{mb.hostname}</span>
                ) : (
                  <Link
                    to={`/o/${orgId}/devices/${mb.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {mb.hostname}
                  </Link>
                )}
                <span className="text-muted-foreground">
                  {mb.role ? t(`clusters.roles.${mb.role}`) : ''} · {mb.model || '—'} ·{' '}
                  {mb.serialNumber || '—'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {joining && (
        <JoinClusterDialog orgId={orgId} device={device} onClose={() => setJoining(false)} />
      )}
      {editing && c && (
        <ClusterDialog orgId={orgId} cluster={c} onClose={() => setEditing(false)} />
      )}
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t('clusters.leaveTitle', { name: c?.name ?? '' })}
        description={last ? t('clusters.leaveLastBody') : t('clusters.leaveBody')}
        confirmLabel={t('clusters.leave')}
        pending={save.isPending}
        onConfirm={leave}
      />
    </section>
  )
}
