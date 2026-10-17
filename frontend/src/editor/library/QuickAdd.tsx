import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { DEVICE_TYPE_GROUPS, useDeviceList, useTemplates } from '@/modules/inventory/devices'
import { DeviceIcon } from '../catalog/icons'
import type { LibraryItem } from './items'
import { matches } from './search'

const MAX_PER_GROUP = 8

/**
 * "/" quick add (SRS §6.4): type a few letters, Enter places the device in the middle of the view. Inventory devices
 * not drawn yet come first (the usual case when documenting an existing network), then templates and types.
 */
export function QuickAdd({
  orgId,
  onView,
  onPick,
  onClose,
}: {
  orgId: string
  onView: ReadonlySet<string>
  onPick: (item: LibraryItem) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const list = useDeviceList(orgId, {
    q,
    facets: {},
    categoryId: null,
    sort: { id: 'hostname', desc: false },
    pageIndex: 0,
    pageSize: 50,
  })
  const templates = useTemplates(orgId)
  const devices = (list.data?.devices ?? [])
    .filter((d) => !onView.has(d.id))
    .slice(0, MAX_PER_GROUP)
  const tpls = (templates.data ?? [])
    .filter((x) => matches(query, x.name, x.vendor, x.model, x.partNumber))
    .slice(0, MAX_PER_GROUP)
  const types = DEVICE_TYPE_GROUPS.flatMap((g) => g.types)
    .filter((ty) => matches(query, ty, t(`devices.types.${ty}`), t(`devices.typeInfo.${ty}`)))
    .slice(0, MAX_PER_GROUP)
  const pick = (item: LibraryItem) => {
    onClose()
    onPick(item)
  }
  const icon = (ty: string) => (
    <DeviceIcon typeId={ty} size={18} className="text-muted-foreground" />
  )

  return (
    <CommandDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('library.quickTitle')}
      description={t('library.quickBody')}
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('library.quickPlaceholder')}
        />
        <CommandList>
          <CommandEmpty>{t('library.noMatch')}</CommandEmpty>
          {devices.length > 0 && (
            <CommandGroup heading={t('library.tabInventory')}>
              {devices.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`device:${d.id}`}
                  onSelect={() =>
                    pick({
                      kind: 'device',
                      device: {
                        id: d.id,
                        hostname: d.hostname,
                        type: d.type,
                        siteId: d.siteId,
                        mgmtIp: d.mgmtIp,
                      },
                    })
                  }
                >
                  {icon(d.type)}
                  <span className="font-medium">{d.hostname}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{d.siteCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {tpls.length > 0 && (
            <CommandGroup heading={t('library.templates')}>
              {tpls.map((x) => (
                <CommandItem
                  key={x.id}
                  value={`template:${x.id}`}
                  onSelect={() => pick({ kind: 'template', templateId: x.id, type: x.type })}
                >
                  {icon(x.type)}
                  <span>{x.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('library.ports', { count: x.portCount })}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {types.length > 0 && (
            <CommandGroup heading={t('library.newOfType')}>
              {types.map((ty) => (
                <CommandItem
                  key={ty}
                  value={`type:${ty}`}
                  onSelect={() => pick({ kind: 'type', type: ty })}
                >
                  {icon(ty)}
                  <span>{t(`devices.types.${ty}`)}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {t(`devices.typeInfo.${ty}`)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
