import { Handshake, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useOrganization } from '@/app/orgs'
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
import { PartnerFormDialog } from './PartnerFormDialog'
import { SitesTable } from './SitesTable'
import { atLeast, useOrgAccess } from './access'
import { useDeletePartner, usePartner } from './sites'
import { UnitFormDialog } from './UnitFormDialog'
import { UnitsTable } from './UnitsTable'

/** Partner detail (ADR-031): its details, units and sites; owner/admin edit or delete it. */
export function PartnerDetailPage() {
  const { t } = useTranslation()
  const { orgId = '', partnerId = '' } = useParams()
  const navigate = useNavigate()
  const org = useOrganization(orgId)
  const partner = usePartner(orgId, partnerId)
  const del = useDeletePartner(orgId)
  const [editing, setEditing] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const u = partner.data
  useBreadcrumbs([{ label: t('units.hub'), to: `/o/${orgId}/sites` }, { label: u?.code ?? '…' }])

  // partner_admins edit the partner and its units; only organization admins delete it.
  const canAdmin = atLeast(u?.access, 'admin')
  const canDelete = useOrgAccess(orgId).orgAdmin

  if (partner.isPending) return <Skeleton className="m-4 h-64" />
  if (!u) return <NotFoundPage inShell />

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <Handshake aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-title font-semibold">
              {u.code} <span className="font-normal text-muted-foreground">· {u.name}</span>
            </h1>
            <p className="text-muted-foreground">
              {t(`partners.relationOf.${u.relation}`, { org: org.data?.organization.name ?? '' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAdmin && (
            <>
              <Button onClick={() => setAddingUnit(true)}>
                <Plus aria-hidden /> {t('units.add')}
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t('partners.edit')}
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
                      {t('partners.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </header>

      <section
        aria-label={t('partners.title')}
        className="max-w-4xl rounded-lg border border-border bg-card p-4"
      >
        <KeyValueList
          columns={2}
          wrap
          items={[
            { label: t('partners.contact'), value: u.contactName || t('common.none') },
            { label: t('sites.contactPhone'), value: u.contactPhone || t('common.none') },
            { label: t('sites.contactEmail'), value: u.contactEmail || t('common.none') },
            { label: t('sites.notes'), value: u.notes || t('common.none') },
          ]}
        />
      </section>

      <h2 className="text-sm font-semibold">
        {t('partners.unitsOf', { code: u.code })}{' '}
        <span className="font-normal text-muted-foreground">{u.unitCount}</span>
      </h2>
      <UnitsTable
        orgId={orgId}
        partnerId={u.id}
        canAdmin={canAdmin}
        onAdd={() => setAddingUnit(true)}
      />

      <h2 className="text-sm font-semibold">
        {t('partners.sitesOf', { code: u.code })}{' '}
        <span className="font-normal text-muted-foreground">{u.siteCount}</span>
      </h2>
      {/* Sites are added from a unit (the unit decides the owner); here they are listed only. */}
      <SitesTable orgId={orgId} partnerId={u.id} canEdit={false} onAdd={() => undefined} />

      {editing && <PartnerFormDialog orgId={orgId} partner={u} onClose={() => setEditing(false)} />}
      {addingUnit && (
        <UnitFormDialog
          orgId={orgId}
          defaultPartnerId={u.id}
          onClose={() => setAddingUnit(false)}
          onSaved={(unit) => navigate(`/o/${orgId}/units/${unit.id}`)}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('partners.deleteTitle', { code: u.code })}
        description={t('partners.deleteBody')}
        confirmText={u.code}
        confirmLabel={t('partners.delete')}
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
