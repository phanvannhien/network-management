import { RefreshCw } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { DEVICE_TYPE_GROUPS, useDeviceList, useTemplates } from '@/modules/inventory/devices'
import { useSites } from '@/modules/sites/sites'
import { hostnameProblem, hostnameStem, hostnameWarning, suggestHostname } from './hostname'
import type { DeviceType } from './items'

export interface NewDeviceInput {
  hostname: string
  type: DeviceType
  siteId: string
  templateId: string | null
}

/**
 * New device from the library (P1-15): the minimum the inventory needs — type, site, hostname — plus an optional
 * organization template that fills vendor/model and generates the ports when the diagram is saved. Everything else
 * is edited later in the property panel or the device page.
 */
export function NewDeviceDialog({
  orgId,
  type: initialType,
  templateId: initialTemplate,
  defaultSiteId,
  takenHostnames,
  onCreate,
  onClose,
}: {
  orgId: string
  type: DeviceType
  templateId: string | null
  defaultSiteId: string | null
  /** Hostnames on this diagram, saved or not; the inventory is searched too. */
  takenHostnames: ReadonlySet<string>
  onCreate: (input: NewDeviceInput) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sites = useSites(orgId)
  const templates = useTemplates(orgId)
  const [type, setType] = useState<DeviceType>(initialType)
  const [templateId, setTemplateId] = useState(initialTemplate ?? '')
  const [siteId, setSiteId] = useState(defaultSiteId ?? '')
  const [hostname, setHostname] = useState<string | null>(null)
  const site = sites.data?.find((s) => s.id === siteId) ?? null
  // Numbers already used in the inventory for this site and prefix (e.g. "AGRI-BD01-FW").
  const stem = useDeferredValue(site ? hostnameStem(site, type) : '')
  const used = useDeviceList(
    orgId,
    { q: stem, facets: {}, categoryId: null, sort: null, pageIndex: 0, pageSize: 200 },
    stem !== '',
  )
  // Until the user types a hostname, it follows the site and the type.
  const suggested = useMemo(() => {
    if (!site) return ''
    const taken = [...takenHostnames, ...(used.data?.devices ?? []).map((d) => d.hostname)]
    return suggestHostname(site, type, taken)
  }, [site, type, takenHostnames, used.data])
  const value = hostname ?? suggested
  const problem = value === '' ? null : hostnameProblem(value)
  const warning = problem ? null : hostnameWarning(value, type)
  const forType = (templates.data ?? []).filter((x) => x.type === type)
  const canSave = siteId !== '' && value.trim() !== '' && problem === null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t('library.newTitle')} className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSave) return
            onCreate({ hostname: value.trim(), type, siteId, templateId: templateId || null })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('library.newTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">{t('library.newBody')}</p>
          <FormField label={t('devices.type')} guide={t(`devices.typeInfo.${type}`)} required>
            {(p) => (
              <NativeSelect
                {...p}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as DeviceType)
                  setTemplateId('')
                }}
              >
                {DEVICE_TYPE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={t(`devices.typeGroups.${g.group}`)}>
                    {g.types.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(`devices.types.${ty}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {forType.length > 0 && (
            <FormField
              label={t('devices.template')}
              guide={t('devices.templateHint')}
              help="template"
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">{t('library.noTemplate')}</option>
                  {forType.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({t('library.ports', { count: x.portCount })})
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
          <FormField label={t('devices.site')} guide={t('library.siteGuide')} help="site" required>
            {(p) => (
              <NativeSelect
                {...p}
                required
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">{t('library.chooseSite')}</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            label={t('devices.hostname')}
            hint={
              warning ? (
                <span className="text-status-warning">{t('library.hostnameNetbios')}</span>
              ) : (
                t('library.hostnameHint')
              )
            }
            guide={t('guides.hostname')}
            help="hostname"
            error={problem && t(`library.hostnameProblems.${problem}`)}
            required
          >
            {(p) => (
              <div className="flex gap-2">
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={63}
                  value={value}
                  onChange={(e) => setHostname(e.target.value)}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('library.suggestAgain')}
                  title={t('library.suggestAgain')}
                  disabled={!site}
                  onClick={() => setHostname(null)}
                >
                  <RefreshCw aria-hidden />
                </Button>
              </div>
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t('library.place')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
