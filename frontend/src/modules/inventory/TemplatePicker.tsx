import { useMemo, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import {
  useCatalog,
  useTemplates,
  type CatalogModel,
  type DeviceTemplate,
  type PortGroup,
} from './devices'
import { matchCatalog } from './import/plan'
import { norm } from './import/parse'

// Templates a new device can be made from (ADR-035 rev.): the organization's own ("org:<id>") and the system ones
// shipped with the software ("sys:<catalog id>"). Typing a model / part number picks the matching one — the
// organization's first — so the device gets its real ports without anyone choosing a template by hand.

export type TemplateChoice = string

export interface ResolvedTemplate {
  kind: 'org' | 'sys'
  id: string
  label: string
  type: DeviceTemplate['type']
  vendor: string
  model: string
  partNumber: string
  uHeight: number
  ports: PortGroup[]
  portCount: number
  verified: boolean
}

const fromOrg = (t: DeviceTemplate): ResolvedTemplate => ({
  kind: 'org',
  id: t.id,
  label: t.name,
  type: t.type,
  vendor: t.vendor,
  model: t.model,
  partNumber: t.partNumber,
  uHeight: t.uHeight,
  ports: t.ports,
  portCount: t.portCount,
  verified: true,
})

const fromSystem = (c: CatalogModel): ResolvedTemplate => ({
  kind: 'sys',
  id: c.id,
  label: `${c.vendor} ${c.model}`,
  type: c.type,
  vendor: c.vendor,
  model: c.model,
  partNumber: c.partNumbers[0] ?? '',
  uHeight: c.uHeight,
  ports: c.ports,
  portCount: c.portCount,
  verified: c.verified,
})

export function useTemplateChoices(orgId: string, enabled = true) {
  const org = useTemplates(orgId, enabled)
  const system = useCatalog(orgId, enabled)
  return useMemo(() => {
    const orgList = org.data ?? []
    const sysList = system.data ?? []
    const resolve = (choice: TemplateChoice | null | undefined): ResolvedTemplate | null => {
      if (!choice) return null
      const [kind, id] = [choice.slice(0, 3), choice.slice(4)]
      if (kind === 'org') {
        const t = orgList.find((x) => x.id === id)
        return t ? fromOrg(t) : null
      }
      const c = sysList.find((x) => x.id === id)
      return c ? fromSystem(c) : null
    }
    /** The template for a model / part number: the organization's first, then the system catalog. */
    const match = (texts: string[], type?: string | null): TemplateChoice | null => {
      const keys = texts.map(norm).filter(Boolean)
      if (keys.length === 0) return null
      const own = orgList.filter((t) =>
        [t.model, t.partNumber, t.name].some((x) => keys.includes(norm(x))),
      )
      const o = own.find((t) => t.type === type) ?? own[0]
      if (o) return `org:${o.id}`
      const c = matchCatalog(sysList, texts, type)
      return c ? `sys:${c.id}` : null
    }
    return {
      org: orgList,
      system: sysList,
      resolve,
      match,
      loading: org.isPending || system.isPending,
    }
  }, [org.data, system.data, org.isPending, system.isPending])
}

/** Select of the organization's templates and the system ones (by vendor), optionally only one device type. */
export function TemplatePicker({
  choices,
  type,
  noneLabel,
  ...props
}: Omit<ComponentProps<'select'>, 'children'> & {
  choices: ReturnType<typeof useTemplateChoices>
  type?: string
  noneLabel: string
}) {
  const { t } = useTranslation()
  const org = choices.org.filter((x) => !type || x.type === type)
  const vendors = new Map<string, CatalogModel[]>()
  for (const c of choices.system)
    if (!type || c.type === type) vendors.set(c.vendor, [...(vendors.get(c.vendor) ?? []), c])
  return (
    <NativeSelect {...props}>
      <option value="">{noneLabel}</option>
      {org.length > 0 && (
        <optgroup label={t('templates.own')}>
          {org.map((x) => (
            <option key={x.id} value={`org:${x.id}`}>
              {x.name} ({t('templates.portCount', { count: x.portCount })})
            </option>
          ))}
        </optgroup>
      )}
      {[...vendors].map(([vendor, list]) => (
        <optgroup key={vendor} label={`${t('templates.system')} · ${vendor}`}>
          {list.map((c) => (
            <option key={c.id} value={`sys:${c.id}`}>
              {c.vendor} {c.model} ({t('templates.portCount', { count: c.portCount })})
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  )
}
