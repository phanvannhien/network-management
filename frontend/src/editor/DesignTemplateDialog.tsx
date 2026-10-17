import { useQueryClient } from '@tanstack/react-query'
import { Building, Building2, Network } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, csrfParam, errorMessage, type components } from '@/api/client'
import { FieldHelp } from '@/components/FieldHelp'
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
import { cn } from '@/lib/utils'
import { useCategories, useSites } from '@/modules/sites/sites'

type DesignRequest = components['schemas']['DesignRequest']
type Preview = components['schemas']['DesignPreview']
type Scenario = DesignRequest['scenario']
type Vendor = DesignRequest['vendor']

const SCENARIOS: { id: Scenario; icon: ReactNode }[] = [
  { id: 'small', icon: <Building aria-hidden className="size-6" /> },
  { id: 'medium', icon: <Building2 aria-hidden className="size-6" /> },
  { id: 'branches', icon: <Network aria-hidden className="size-6" /> },
]
const VENDORS: Vendor[] = ['fortinet_cisco', 'fortinet_aruba', 'tplink_omada', 'ubiquiti']
/** Stacks whose gateways run as an HA pair (and cores as a stack) — ADR-039. */
const HA_VENDORS: Vendor[] = ['fortinet_cisco', 'fortinet_aruba']

function Check({
  checked,
  disabled,
  onChange,
  label,
  guide,
  help,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
  guide: string
  help?: string
}) {
  return (
    <div className={cn('flex items-start gap-2', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        className="mt-1 size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0">
        <span className="flex items-center gap-1 text-sm font-medium">
          {label}
          {help && <FieldHelp term={help} />}
        </span>
        <p className="text-xs text-muted-foreground">{guide}</p>
      </div>
    </div>
  )
}

/**
 * Create a diagram from a design template (P2-23, ADR-039): pick a scenario, set the options, check the preview
 * (planned devices, groups, VLAN / IP plan — nothing written yet), create. The server writes everything in one go;
 * the new diagram opens.
 */
export function DesignTemplateDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const categories = useCategories(orgId)
  const sites = useSites(orgId)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [scenario, setScenario] = useState<Scenario>('small')
  const [vendor, setVendor] = useState<Vendor>('fortinet_cisco')
  const [users, setUsers] = useState(30)
  const [branches, setBranches] = useState(3)
  const [branchUsers, setBranchUsers] = useState(40)
  const [ha, setHa] = useState(false)
  const [remoteVpn, setRemoteVpn] = useState(true)
  const [phones, setPhones] = useState(false)
  const [cameras, setCameras] = useState(true)
  const [guestWifi, setGuestWifi] = useState(true)
  const [categoryId, setCategoryId] = useState('')
  const [existingSiteId, setExistingSiteId] = useState('')
  const [siteName, setSiteName] = useState('')
  const [diagramName, setDiagramName] = useState('')

  const haAllowed = HA_VENDORS.includes(vendor)
  const body = (): DesignRequest => ({
    scenario,
    vendor,
    users,
    ha: ha && haAllowed,
    remoteVpn,
    phones,
    cameras,
    guestWifi,
    ...(scenario === 'branches' ? { branches, branchUsers } : {}),
    ...(existingSiteId && scenario !== 'branches'
      ? { existingSiteId }
      : {
          ...(categoryId ? { categoryId } : {}),
          ...(siteName.trim() ? { siteNames: [siteName.trim()] } : {}),
        }),
    ...(diagramName.trim() ? { diagramName: diagramName.trim() } : {}),
  })

  const runPreview = async () => {
    setBusy(true)
    try {
      const r = await api.POST('/orgs/{orgId}/design-templates/preview', {
        params: { ...csrfParam, path: { orgId } },
        body: body(),
      })
      if (!r.data) throw new Error(errorMessage(r.error, r.response.status, t('design.failed')))
      setPreview(r.data)
      setStep(3)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    try {
      const r = await api.POST('/orgs/{orgId}/design-templates/apply', {
        params: { ...csrfParam, path: { orgId } },
        body: body(),
      })
      if (!r.data) throw new Error(errorMessage(r.error, r.response.status, t('design.failed')))
      toast.success(
        t('design.done', { devices: r.data.devices, cables: r.data.cables, sites: r.data.sites }),
      )
      for (const w of r.data.warnings.slice(0, 5)) toast.warning(w)
      void qc.invalidateQueries({ queryKey: ['orgs', orgId] })
      void navigate(`/o/${orgId}/diagrams/${r.data.diagramId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Preview grouped: one row per model and site, with a count (a draft bill of quantities).
  const bom = new Map<
    string,
    { site: string; role: string; model: string; vendor: string; count: number }
  >()
  for (const d of preview?.devices ?? []) {
    const k = `${d.site}|${d.role}|${d.model}`
    const row = bom.get(k) ?? {
      site: d.site,
      role: d.role,
      model: d.model,
      vendor: d.vendor,
      count: 0,
    }
    row.count++
    bom.set(k, row)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('design.title')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('design.title')} · {t('design.step', { step })}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('design.intro')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={scenario === s.id}
                  onClick={() => {
                    setScenario(s.id)
                    setUsers(s.id === 'medium' ? 80 : s.id === 'branches' ? 60 : 30)
                  }}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left hover:bg-muted',
                    scenario === s.id ? 'border-primary ring-1 ring-primary' : 'border-border',
                  )}
                >
                  <span className="text-primary">{s.icon}</span>
                  <span className="font-medium">{t(`design.scenarios.${s.id}.name`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`design.scenarios.${s.id}.what`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label={scenario === 'branches' ? t('design.hqUsers') : t('design.users')}
                guide={t('design.usersGuide')}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={5}
                    max={250}
                    value={users}
                    onChange={(e) => setUsers(Number(e.target.value))}
                  />
                )}
              </FormField>
              <FormField label={t('design.vendor')} guide={t('design.vendorGuide')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value as Vendor)}
                  >
                    {VENDORS.map((v) => (
                      <option key={v} value={v}>
                        {t(`design.vendors.${v}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {scenario === 'branches' && (
                <>
                  <FormField label={t('design.branches')} guide={t('design.branchesGuide')}>
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min={1}
                        max={20}
                        value={branches}
                        onChange={(e) => setBranches(Number(e.target.value))}
                      />
                    )}
                  </FormField>
                  <FormField label={t('design.branchUsers')}>
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min={5}
                        max={100}
                        value={branchUsers}
                        onChange={(e) => setBranchUsers(Number(e.target.value))}
                      />
                    )}
                  </FormField>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Check
                label={t('design.ha')}
                guide={haAllowed ? t('design.haGuide') : t('design.haNo')}
                help="ha"
                checked={ha && haAllowed}
                disabled={!haAllowed}
                onChange={setHa}
              />
              <Check
                label={t('design.remoteVpn')}
                guide={t('design.remoteVpnGuide')}
                help="vpn"
                checked={remoteVpn}
                onChange={setRemoteVpn}
              />
              <Check
                label={t('design.phones')}
                guide={t('design.phonesGuide')}
                checked={phones}
                onChange={setPhones}
              />
              <Check
                label={t('design.cameras')}
                guide={t('design.camerasGuide')}
                checked={cameras}
                onChange={setCameras}
              />
              <Check
                label={t('design.guestWifi')}
                guide={t('design.guestWifiGuide')}
                checked={guestWifi}
                onChange={setGuestWifi}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scenario !== 'branches' && (
                <FormField label={t('design.where')} guide={t('design.whereGuide')}>
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={existingSiteId}
                      onChange={(e) => setExistingSiteId(e.target.value)}
                    >
                      <option value="">{t('design.newSite')}</option>
                      {(sites.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
              {(!existingSiteId || scenario === 'branches') && (
                <>
                  <FormField label={t('design.category')} guide={t('design.categoryGuide')}>
                    {(p) => (
                      <NativeSelect
                        {...p}
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                      >
                        <option value="">{t('design.noCategory')}</option>
                        {(categories.data ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.path}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </FormField>
                  <FormField
                    label={scenario === 'branches' ? t('design.hqName') : t('design.siteName')}
                    guide={t('design.siteNameGuide')}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        maxLength={120}
                        placeholder={scenario === 'branches' ? 'Trụ sở' : 'Văn phòng'}
                        value={siteName}
                        onChange={(e) => setSiteName(e.target.value)}
                      />
                    )}
                  </FormField>
                </>
              )}
              <FormField label={t('design.diagramName')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={120}
                    placeholder={t(`design.scenarios.${scenario}.name`)}
                    value={diagramName}
                    onChange={(e) => setDiagramName(e.target.value)}
                  />
                )}
              </FormField>
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
            <p>
              {t('design.summary', {
                devices: preview.totals.devices,
                cables: preview.totals.cables,
                sites: preview.totals.sites,
              })}
            </p>
            {preview.warnings.length > 0 && (
              <ul className="list-disc rounded-md border border-status-warning/40 bg-status-warning/10 p-2 pl-6 text-xs">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {preview.notes.length > 0 && (
              <section aria-label={t('design.notesTitle')}>
                <h3 className="font-medium">{t('design.notesTitle')}</h3>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {preview.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-label={t('design.devicesTitle')}>
              <h3 className="font-medium">{t('design.devicesTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('design.devicesGuide')}</p>
              <table className="mt-1 w-full">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">{t('design.site')}</th>
                    <th className="py-1 font-medium">{t('design.role')}</th>
                    <th className="py-1 font-medium">{t('design.model')}</th>
                    <th className="py-1 text-right font-medium">{t('design.count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bom.values()].map((r) => (
                    <tr key={`${r.site}|${r.role}|${r.model}`} className="border-t border-border">
                      <td className="py-1 pr-2">{r.site}</td>
                      <td className="py-1 pr-2">
                        {t(`design.roles.${r.role}` as 'design.roles.firewall')}
                      </td>
                      <td className="py-1 pr-2">
                        {r.vendor} {r.model}
                      </td>
                      <td data-numeric className="py-1 text-right">
                        {r.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section aria-label={t('design.groupsTitle')}>
              <h3 className="font-medium">{t('design.groupsTitle')}</h3>
              <ul className="mt-1 text-xs">
                {preview.groups.map((g) => (
                  <li key={`${g.site}|${g.name}`}>
                    {g.site}: {g.name} ×{g.count}
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label={t('design.ipTitle')}>
              <h3 className="font-medium">{t('design.ipTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('design.ipGuide')}</p>
              <table className="mt-1 w-full font-mono text-tech">
                <thead className="text-left font-sans text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">{t('design.site')}</th>
                    <th className="py-1 pr-2 font-medium">VLAN</th>
                    <th className="py-1 pr-2 font-medium">{t('design.purpose')}</th>
                    <th className="py-1 font-medium">Subnet</th>
                    <th className="py-1 font-medium">Gateway</th>
                    <th className="py-1 font-medium">{t('design.range')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.subnets.map((s) => (
                    <tr key={`${s.site}|${s.cidr}`} className="border-t border-border">
                      <td className="py-1 pr-2 font-sans">{s.site}</td>
                      <td className="py-1 pr-2">{s.vlan || '—'}</td>
                      <td className="py-1 pr-2 font-sans">{s.name}</td>
                      <td className="py-1 pr-2">{s.cidr}</td>
                      <td className="py-1 pr-2">{s.gateway || '—'}</td>
                      <td className="py-1">{s.dhcp || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : () => setStep(step === 3 ? 2 : 1)}
          >
            {step === 1 ? t('common.cancel') : t('design.back')}
          </Button>
          {step === 1 && <Button onClick={() => setStep(2)}>{t('design.next')}</Button>}
          {step === 2 && (
            <Button disabled={busy} onClick={() => void runPreview()}>
              {busy ? t('design.working') : t('design.preview')}
            </Button>
          )}
          {step === 3 && (
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? t('design.working') : t('design.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
