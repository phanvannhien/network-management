import { Share2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useShareMutations, useSiteShares, type ShareAccess, type SiteShare } from './grants'
import { useBusinessUnits, usePartners, type Site } from './sites'

/**
 * Shares of a site (ADR-029/031), for admins of the site: share to a partner (all its units) or one unit,
 * read-only or editable; change or revoke. Targets are any partner / unit of the organization.
 */
export function SiteSharesPanel({ orgId, site }: { orgId: string; site: Site }) {
  const { t } = useTranslation()
  const shares = useSiteShares(orgId, site.id)
  const partners = usePartners(orgId)
  const units = useBusinessUnits(orgId)
  const { create, update, remove } = useShareMutations(orgId, site.id)
  const [target, setTarget] = useState('')
  const [access, setAccess] = useState<ShareAccess>('view')
  const [revoking, setRevoking] = useState<SiteShare | null>(null)

  const onShare = (e: FormEvent) => {
    e.preventDefault()
    const [kind, id] = target.split(':')
    create.mutate(
      { targetType: kind === 'p' ? 'partner' : 'business_unit', targetId: id, access },
      {
        onSuccess: (sh) => {
          setTarget('')
          toast.success(t('shares.created', { target: sh.targetCode }))
        },
      },
    )
  }

  const accessSelect = (value: ShareAccess, onChange: (a: ShareAccess) => void, label: string) => (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as ShareAccess)}
    >
      <option value="view">{t('shares.view')}</option>
      <option value="edit">{t('shares.edit')}</option>
    </NativeSelect>
  )

  return (
    <section aria-label={t('shares.title')} className="max-w-4xl space-y-3">
      <p className="text-muted-foreground">{t('shares.hint')}</p>
      <form
        onSubmit={onShare}
        className="grid grid-cols-[1fr_180px_auto] items-end gap-2 rounded-lg border border-border bg-card p-4"
      >
        <FormField label={t('shares.target')}>
          {(p) => (
            <NativeSelect
              {...p}
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t('shares.chooseTarget')}</option>
              {(partners.data ?? []).map((pt) => (
                <optgroup key={pt.id} label={`${pt.code} · ${pt.name}`}>
                  {pt.id !== site.partnerId && (
                    <option value={`p:${pt.id}`}>
                      {t('shares.wholePartner', { code: pt.code })}
                    </option>
                  )}
                  {(units.data ?? [])
                    .filter((u) => u.partnerId === pt.id && u.id !== site.businessUnitId)
                    .map((u) => (
                      <option key={u.id} value={`u:${u.id}`}>
                        {pt.code} › {u.code} · {u.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('shares.access')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={access}
              onChange={(e) => setAccess(e.target.value as ShareAccess)}
            >
              <option value="view">{t('shares.view')}</option>
              <option value="edit">{t('shares.edit')}</option>
            </NativeSelect>
          )}
        </FormField>
        <Button type="submit" disabled={create.isPending || target === ''}>
          <Share2 aria-hidden /> {t('shares.share')}
        </Button>
      </form>
      {create.isError && (
        <p role="alert" className="text-destructive">
          {create.error.message}
        </p>
      )}
      {shares.isPending ? (
        <Skeleton className="h-16" />
      ) : shares.isError ? (
        <p role="alert" className="text-destructive">
          {shares.error.message}
        </p>
      ) : shares.data.length === 0 ? (
        <p className="text-muted-foreground">{t('shares.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {shares.data.map((sh) => (
            <li key={sh.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{sh.targetCode}</span>{' '}
                <span className="text-muted-foreground">
                  · {sh.targetName} ·{' '}
                  {sh.targetType === 'partner' ? t('shares.toPartner') : t('shares.toUnit')}
                </span>
              </div>
              <div className="w-40">
                {accessSelect(
                  sh.access,
                  (a) =>
                    update.mutate(
                      { share: sh, access: a },
                      {
                        onSuccess: () => toast.success(t('shares.saved')),
                        onError: (err) => toast.error(err.message),
                      },
                    ),
                  t('shares.accessOf', { target: sh.targetCode }),
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('shares.revokeOf', { target: sh.targetCode })}
                onClick={() => setRevoking(sh)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('shares.revokeTitle', { target: revoking?.targetCode ?? '' })}
        description={t('shares.revokeBody')}
        confirmLabel={t('shares.revoke')}
        pending={remove.isPending}
        onConfirm={() =>
          revoking &&
          remove.mutate(revoking, {
            onSuccess: () => {
              setRevoking(null)
              toast.success(t('shares.revoked'))
            },
            onError: (err) => {
              setRevoking(null)
              toast.error(err.message)
            },
          })
        }
      />
    </section>
  )
}
