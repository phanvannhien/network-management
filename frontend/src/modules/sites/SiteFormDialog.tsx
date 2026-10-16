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
import {
  SITE_KINDS,
  buildTree,
  flattenTree,
  previewSiteCode,
  suggestSiteCode,
  useCategories,
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
 * Create (site undefined) or edit a site (ADR-032). The site sits in a category or straight under the
 * organization and has its own short code; the full code <ORG>-<categories>-<site> is shown live. While the
 * user has not typed a code, the next free <PLACE><NN> is suggested from the place.
 */
export function SiteFormDialog({
  orgId,
  site,
  defaultCategoryId,
  open,
  onClose,
  onSaved,
}: {
  orgId: string
  site?: Site
  defaultCategoryId?: string | null
  open: boolean
  onClose: () => void
  onSaved?: (site: Site) => void
}) {
  const { t } = useTranslation()
  const save = useSaveSite(orgId)
  const categories = useCategories(orgId)
  const org = useOrganization(orgId).data?.organization
  const orgName = org?.name ?? ''
  const [f, setF] = useState({
    code: site?.localCode ?? '',
    name: site?.name ?? '',
    kind: (site?.kind ?? 'office') as SiteKind,
    categoryId: site ? site.categoryId : (defaultCategoryId ?? null),
    isp: site?.isp ?? '',
    address: site?.address ?? '',
    timezone: site?.timezone ?? 'Asia/Ho_Chi_Minh',
    contactName: site?.contactName ?? '',
    contactPhone: site?.contactPhone ?? '',
    contactEmail: site?.contactEmail ?? '',
    notes: site?.notes ?? '',
  })
  const [place, setPlace] = useState(
    site ? (/^([A-Z]{2,4})\d{2}$/.exec(site.localCode)?.[1] ?? '') : '',
  )
  const [placeTouched, setPlaceTouched] = useState(Boolean(site))
  const codeTouched = useRef(Boolean(site))
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value })
  const tree = flattenTree(buildTree(categories.data ?? []))
  const fullCode = previewSiteCode(org?.code ?? '', categories.data ?? [], f.categoryId, f.code)

  // The place is derived from the name/address until the user types one.
  const effectivePlace = placeTouched ? place : placeCode(`${f.name} ${f.address}`).slice(0, 4)

  const suggest = async (force = false) => {
    if ((!force && codeTouched.current) || !/^[A-Z]{2,4}$/.test(effectivePlace)) return
    const code = await suggestSiteCode(orgId, f.categoryId, effectivePlace)
    if (code) setF((cur) => ({ ...cur, code }))
    if (force) codeTouched.current = false
  }
  useEffect(() => {
    void suggest()
    // re-suggest when the category or place changes (not on every keystroke elsewhere)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.categoryId, effectivePlace])

  const codeProblem = f.code !== '' && !/^[A-Z0-9]{1,12}$/.test(f.code.toUpperCase())

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
            <FormField label={t('sites.category')} help="category" guide={t('guides.siteCategory')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.categoryId ?? ''}
                  onChange={(e) => setF({ ...f, categoryId: e.target.value || null })}
                >
                  <option value="">{t('categories.orgLevel', { org: orgName })}</option>
                  {tree.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'\u00a0\u00a0'.repeat(c.depth + 1)}
                      {c.name} ({c.code})
                    </option>
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
              hint={
                <>
                  {t('sites.codeRule')}{' '}
                  <span className="font-medium text-foreground">
                    {t('sites.fullCode')}: <span className="font-mono">{fullCode}</span>
                  </span>
                </>
              }
              error={codeProblem ? t('sites.codeRule') : undefined}
            >
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    required
                    maxLength={12}
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
            <Button type="submit" disabled={save.isPending || codeProblem}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
