import { Building2, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KeyValueList } from '@/components/KeyValueList'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { SiteFormDialog } from './SiteFormDialog'
import { SitesTable } from './SitesTable'
import { atLeast, useOrgAccess } from './access'
import { useBusinessUnit, useDeleteUnit } from './sites'
import { UnitFormDialog } from './UnitFormDialog'

/** Business unit detail (ADR-031): its partner, details and sites; owner/admin edit or delete it. */
export function UnitDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', unitId = '' } = useParams()
  const navigate = useNavigate()
  const unit = useBusinessUnit(orgId, unitId)
  const del = useDeleteUnit(orgId)
  const [editing, setEditing] = useState(false)
  const [addingSite, setAddingSite] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const u = unit.data
  useBreadcrumbs([
    { label: t('units.hub'), to: `/o/${orgId}/sites` },
    u ? { label: u.partnerCode, to: `/o/${orgId}/partners/${u.partnerId}` } : { label: '…' },
    { label: u?.code ?? '…' },
  ])

  // unit_admins edit the unit; deleting it is for organization / partner admins.
  const access = useOrgAccess(orgId)
  const canAdmin = atLeast(u?.access, 'admin')
  const canEdit = atLeast(u?.access, 'edit')
  const canDelete = u ? access.partnerAdminOf(u.partnerId) : false

  if (unit.isPending) return <Skeleton className="m-4 h-64" />
  if (!u) return <NotFoundPage inShell />

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <Building2 aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-title font-semibold">
              {u.code} <span className="font-normal text-muted-foreground">· {u.name}</span>
            </h1>
            <p className="text-muted-foreground">
              {t('units.partner')}:{' '}
              <Link
                to={`/o/${orgId}/partners/${u.partnerId}`}
                className="hover:text-foreground hover:underline"
              >
                {u.partnerCode} · {u.partnerName}
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button onClick={() => setAddingSite(true)}>
              <Plus aria-hidden /> {t('sites.add')}
            </Button>
          )}
          {canAdmin && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t('units.edit')}
              </Button>
              {canDelete && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" size="icon" aria-label={t('common.more')} />}
                  >
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                      {t('units.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </header>

      <section
        aria-label={t('units.title')}
        className="max-w-4xl rounded-lg border border-border bg-card p-4"
      >
        <KeyValueList
          columns={2}
          wrap
          items={[
            { label: t('units.contact'), value: u.contactName || t('common.none') },
            { label: t('sites.contactPhone'), value: u.contactPhone || t('common.none') },
            { label: t('sites.contactEmail'), value: u.contactEmail || t('common.none') },
            { label: t('sites.notes'), value: u.notes || t('common.none') },
          ]}
        />
      </section>

      <h2 className="text-sm font-semibold">
        {t('units.sitesOf', { code: u.code })}{' '}
        <span className="font-normal text-muted-foreground">{u.siteCount}</span>
      </h2>
      <SitesTable orgId={orgId} unitId={u.id} canEdit={canEdit} onAdd={() => setAddingSite(true)} />

      {editing && <UnitFormDialog orgId={orgId} unit={u} onClose={() => setEditing(false)} />}
      {addingSite && (
        <SiteFormDialog
          orgId={orgId}
          defaultUnitId={u.id}
          open
          onClose={() => setAddingSite(false)}
          onSaved={(s) => navigate(`/o/${orgId}/sites/${s.id}`)}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('units.deleteTitle', { code: u.code })}
        description={t('units.deleteBody')}
        confirmText={u.code}
        confirmLabel={t('units.delete')}
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(u.id, {
            onSuccess: () => {
              toast.success(t('sites.saved'))
              navigate(`/o/${orgId}/sites`, { replace: true })
            },
            onError: (e) => {
              setDeleting(false)
              toast.error(e.message)
            },
          })
        }
      />
    </div>
  )
}
