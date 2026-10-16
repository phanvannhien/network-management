import { Wand2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Textarea } from '@/components/ui/textarea'
import { useOrganization } from '@/app/orgs'
import { placeCode } from '@/lib/placeCode'
import { atLeast, useOrgAccess } from './access'
import {
  SITE_KINDS,
  siteCodeError,
  suggestSiteCode,
  useBusinessUnits,
  usePartners,
  useSaveSite,
  type Site,
  type SiteKind,
} from './sites'

/** Common IANA zones first; any valid IANA name is accepted by the API. */
const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'UTC',
]

/**
 * Create (site undefined) or edit a site. The code follows ADR-030/031 (<PARTNER>-<PLACE><NN>, the
 * partner of the chosen unit): while the user has not typed a code, it is suggested from the partner +
 * place via the API (next free number).
 */
export function SiteFormDialog({
  orgId,
  site,
  defaultUnitId,
  open,
  onClose,
  onSaved,
}: {
  orgId: string
  site?: Site
  defaultUnitId?: string | null
  open: boolean
  onClose: () => void
  onSaved?: (site: Site) => void
}) {
  const { t } = useTranslation()
  const save = useSaveSite(orgId)
  const units = useBusinessUnits(orgId)
  const partners = usePartners(orgId)
  const access = useOrgAccess(orgId)
  const orgName = useOrganization(orgId).data?.organization.name ?? ''
  const [f, setF] = useState({
    code: site?.code ?? '',
    name: site?.name ?? '',
    kind: (site?.kind ?? 'office') as SiteKind,
    businessUnitId: site ? site.businessUnitId : (defaultUnitId ?? null),
    isp: site?.isp ?? '',
    address: site?.address ?? '',
    timezone: site?.timezone ?? 'Asia/Ho_Chi_Minh',
    contactName: site?.contactName ?? '',
    contactPhone: site?.contactPhone ?? '',
    contactEmail: site?.contactEmail ?? '',
    notes: site?.notes ?? '',
  })
  const [place, setPlace] = useState(
    site ? (/^[A-Z0-9]+-([A-Z]{2,4})\d{2}$/.exec(site.code)?.[1] ?? '') : '',
  )
  const [placeTouched, setPlaceTouched] = useState(Boolean(site))
  const codeTouched = useRef(Boolean(site))
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const unit = units.data?.find((u) => u.id === f.businessUnitId)
  const partnerId = unit?.partnerId ?? null
  const partnerCode = unit?.partnerCode ?? null

  // The place is derived from the name/address until the user types one.
  const effectivePlace = placeTouched ? place : placeCode(`${f.name} ${f.address}`).slice(0, 4)

  const suggest = async (force = false) => {
    if ((!force && codeTouched.current) || !/^[A-Z]{2,4}$/.test(effectivePlace)) return
    const code = await suggestSiteCode(orgId, partnerId, effectivePlace)
    if (code) setF((cur) => ({ ...cur, code }))
    if (force) codeTouched.current = false
  }
  useEffect(() => {
    void suggest()
    // re-suggest when the partner or place changes (not on every keystroke elsewhere)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, effectivePlace])

  const codeProblem = f.code ? siteCodeError(f.code, partnerCode) : null

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { siteId: site?.id, body: { ...f, code: f.code.toUpperCase() }, version: site?.version },
      {
        onSuccess: (saved) => {
          toast.success(site ? t('sites.saved') : t('sites.created', { code: saved.code }))
          onSaved?.(saved)
          onClose()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={site ? t('sites.edit') : t('sites.add')}
        >
          <DialogHeader>
            <DialogTitle>{site ? t('sites.edit') : t('sites.addTo', { org: orgName })}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={t('sites.unit')}
              help="partner-unit"
              hint={f.businessUnitId ? undefined : t('units.sharedHint')}
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.businessUnitId ?? ''}
                  onChange={(e) => setF({ ...f, businessUnitId: e.target.value || null })}
                >
                  {/* Shared sites need an organization-wide editor; units need edit access (ADR-031).
                      The site's current owner stays listed so editing through a share keeps it. */}
                  {(access.orgEdit || (site && !site.businessUnitId)) && (
                    <option value="">{t('units.shared')}</option>
                  )}
                  {site?.businessUnitId &&
                    !units.data?.some((u) => u.id === site.businessUnitId) && (
                      <option value={site.businessUnitId}>
                        {site.partnerCode} › {site.businessUnitCode} · {site.businessUnitName}
                      </option>
                    )}
                  {(partners.data ?? []).map((pt) => (
                    <optgroup key={pt.id} label={`${pt.code} · ${pt.name}`}>
                      {(units.data ?? [])
                        .filter(
                          (u) =>
                            u.partnerId === pt.id &&
                            (atLeast(u.access, 'edit') || u.id === site?.businessUnitId),
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {pt.code} › {u.code} · {u.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('sites.kind')} guide={t('guides.siteKind')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value as SiteKind })}
                >
                  {SITE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`sites.siteKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <FormField label={t('sites.name')} required>
            {(p) => (
              <Input
                {...p}
                required
                autoFocus
                maxLength={200}
                value={f.name}
                onChange={set('name')}
              />
            )}
          </FormField>
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <FormField label={t('sites.place')} hint={t('sites.placeHint')}>
              {(p) => (
                <Input
                  {...p}
                  maxLength={4}
                  value={effectivePlace}
                  onChange={(e) => {
                    setPlaceTouched(true)
                    setPlace(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                  }}
                  className="font-mono uppercase"
                />
              )}
            </FormField>
            <FormField
              label={t('sites.code')}
              help="site"
              required
              hint={t('sites.codeRule')}
              error={
                codeProblem === 'prefix'
                  ? `${t('sites.codeRule')} (${partnerCode ?? 'SHARED'}-…)`
                  : codeProblem === 'format'
                    ? t('sites.codeRule')
                    : undefined
              }
            >
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    required
                    maxLength={32}
                    value={f.code}
                    onChange={(e) => {
                      codeTouched.current = true
                      setF({ ...f, code: e.target.value.toUpperCase() })
                    }}
                    className="font-mono uppercase"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void suggest(true)}
                    title={t('sites.suggest')}
                  >
                    <Wand2 aria-hidden /> {t('sites.suggest')}
                  </Button>
                </div>
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('sites.address')}>
              {(p) => <Input {...p} maxLength={500} value={f.address} onChange={set('address')} />}
            </FormField>
            <FormField label={t('sites.isp')} guide={t('guides.isp')}>
              {(p) => <Input {...p} maxLength={200} value={f.isp} onChange={set('isp')} />}
            </FormField>
          </div>
          <FormField label={t('sites.timezone')} guide={t('guides.timezone')}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list="ntb-timezones"
                  value={f.timezone}
                  onChange={set('timezone')}
                  className="font-mono"
                />
                <datalist id="ntb-timezones">
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-form font-medium">{t('sites.contact')}</legend>
            <FormField label={t('sites.contactName')}>
              {(p) => (
                <Input {...p} maxLength={200} value={f.contactName} onChange={set('contactName')} />
              )}
            </FormField>
            <FormField label={t('sites.contactPhone')}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  maxLength={50}
                  value={f.contactPhone}
                  onChange={set('contactPhone')}
                />
              )}
            </FormField>
            <FormField label={t('sites.contactEmail')}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  maxLength={320}
                  value={f.contactEmail}
                  onChange={set('contactEmail')}
                />
              )}
            </FormField>
          </fieldset>
          <FormField label={t('sites.notes')}>
            {(p) => (
              <Textarea {...p} rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
            )}
          </FormField>
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || codeProblem !== null}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
