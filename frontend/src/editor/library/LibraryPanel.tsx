import { LayoutTemplate, PackageSearch, PanelLeftClose, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEVICE_TYPE_GROUPS, useDeviceList, useTemplates } from '@/modules/inventory/devices'
import { DeviceIcon } from '../catalog/icons'
import {
  ENDPOINT_KINDS,
  encodeItem,
  LIBRARY_MIME,
  type DeviceType,
  type LibraryItem,
} from './items'
import { matches } from './search'

/**
 * Floating library (P1-15, SRS §6.1): new devices by type or organization template, and inventory devices not yet on
 * this diagram. Every entry can be dragged onto the canvas or clicked (placed in the middle of the view); each type
 * has a one-line description for non-specialists (DESIGN.md §4a).
 */
export function LibraryPanel({
  orgId,
  onView,
  onPick,
  onClose,
  onMinimize,
}: {
  orgId: string
  /** Inventory ids already drawn. */
  onView: ReadonlySet<string>
  onPick: (item: LibraryItem) => void
  onClose: () => void
  /** Fold to a rail at the canvas edge. */
  onMinimize: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'new' | 'inventory'>('new')
  const [query, setQuery] = useState('')
  return (
    <aside
      aria-label={t('library.title')}
      className="absolute top-16 bottom-3 left-3 z-10 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 font-semibold">{t('library.title')}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('library.minimize')}
          title={t('library.minimize')}
          onClick={onMinimize}
        >
          <PanelLeftClose aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('library.close')}
          title={`${t('library.close')} (B)`}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="space-y-2 border-b border-border p-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('library.search')}
            aria-label={t('library.search')}
          />
          <TabsList className="w-full">
            <TabsTrigger value="new" className="flex-1">
              <LayoutTemplate aria-hidden /> {t('library.tabNew')}
            </TabsTrigger>
            <TabsTrigger value="inventory" className="flex-1">
              <PackageSearch aria-hidden /> {t('library.tabInventory')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="new" className="min-h-0 flex-1 overflow-y-auto p-2">
          <NewDevices orgId={orgId} query={query} onPick={onPick} />
        </TabsContent>
        <TabsContent value="inventory" className="min-h-0 flex-1 overflow-y-auto p-2">
          {tab === 'inventory' && (
            <InventoryDevices orgId={orgId} query={query} onView={onView} onPick={onPick} />
          )}
        </TabsContent>
      </Tabs>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {t('library.footer')}
      </p>
    </aside>
  )
}

function Entry({
  item,
  icon,
  title,
  detail,
  label,
  onPick,
}: {
  item: LibraryItem
  icon: ReactNode
  title: string
  detail: string
  /** Accessible name: action + object. */
  label: string
  onPick: (item: LibraryItem) => void
}) {
  return (
    <li>
      <button
        type="button"
        draggable
        aria-label={label}
        onDragStart={(e) => {
          e.dataTransfer.setData(LIBRARY_MIME, encodeItem(item))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => onPick(item)}
        className="flex w-full cursor-grab items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    </li>
  )
}

const icon = (type: DeviceType, size = 20) => <DeviceIcon typeId={type} size={size} />

function NewDevices({
  orgId,
  query,
  onPick,
}: {
  orgId: string
  query: string
  onPick: (item: LibraryItem) => void
}) {
  const { t } = useTranslation()
  const templates = useTemplates(orgId)
  const groups = useMemo(
    () =>
      DEVICE_TYPE_GROUPS.map((g) => ({
        group: g.group,
        // Endpoint kinds are offered as endpoints below (ADR-036), not as inventory devices.
        types: g.types.filter(
          (ty) =>
            !(ENDPOINT_KINDS as string[]).includes(ty) &&
            matches(query, ty, t(`devices.types.${ty}`), t(`devices.typeInfo.${ty}`)),
        ),
      })).filter((g) => g.types.length > 0),
    [query, t],
  )
  const endpoints = ENDPOINT_KINDS.filter((k) =>
    matches(query, k, t(`devices.types.${k}`), t('library.endpoints')),
  )
  const tpls = (templates.data ?? []).filter((x) =>
    matches(query, x.name, x.vendor, x.model, x.partNumber, t(`devices.types.${x.type}`)),
  )
  if (groups.length === 0 && tpls.length === 0 && endpoints.length === 0)
    return <p className="px-1 py-4 text-center text-muted-foreground">{t('library.noMatch')}</p>
  return (
    <div className="space-y-3">
      {tpls.length > 0 && (
        <section aria-label={t('library.templates')}>
          <h3 className="px-1 pb-1 text-label font-medium text-muted-foreground">
            {t('library.templates')}
          </h3>
          <ul className="space-y-0.5">
            {tpls.map((x) => (
              <Entry
                key={x.id}
                item={{ kind: 'template', templateId: x.id, type: x.type }}
                icon={icon(x.type)}
                title={x.name}
                detail={t('library.templateDetail', {
                  type: t(`devices.types.${x.type}`),
                  count: x.portCount,
                })}
                label={t('library.addNew', { name: x.name })}
                onPick={onPick}
              />
            ))}
          </ul>
        </section>
      )}
      {endpoints.length > 0 && (
        <section aria-label={t('library.endpoints')}>
          <h3 className="px-1 text-label font-medium text-muted-foreground">
            {t('library.endpoints')}
          </h3>
          <p className="px-1 pb-1 text-xs text-muted-foreground">{t('library.endpointsGuide')}</p>
          <ul className="space-y-0.5">
            {endpoints.map((k) => (
              <Entry
                key={k}
                item={{ kind: 'endpoint', endpointKind: k }}
                icon={icon(k)}
                title={t(`devices.types.${k}`)}
                detail={t('library.endpointDetail')}
                label={t('library.addNew', { name: t(`devices.types.${k}`) })}
                onPick={onPick}
              />
            ))}
          </ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.group} aria-label={t(`devices.typeGroups.${g.group}`)}>
          <h3 className="px-1 pb-1 text-label font-medium text-muted-foreground">
            {t(`devices.typeGroups.${g.group}`)}
          </h3>
          <ul className="space-y-0.5">
            {g.types.map((ty) => (
              <Entry
                key={ty}
                item={{ kind: 'type', type: ty }}
                icon={icon(ty)}
                title={t(`devices.types.${ty}`)}
                detail={t(`devices.typeInfo.${ty}`)}
                label={t('library.addNew', { name: t(`devices.types.${ty}`) })}
                onPick={onPick}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const INVENTORY_PAGE = 100

function InventoryDevices({
  orgId,
  query,
  onView,
  onPick,
}: {
  orgId: string
  query: string
  onView: ReadonlySet<string>
  onPick: (item: LibraryItem) => void
}) {
  const { t } = useTranslation()
  const q = useDeferredValue(query.trim())
  const list = useDeviceList(orgId, {
    q,
    facets: {},
    categoryId: null,
    sort: { id: 'hostname', desc: false },
    pageIndex: 0,
    pageSize: INVENTORY_PAGE,
  })
  if (list.isPending)
    return <p className="px-1 py-4 text-center text-muted-foreground">{t('library.loading')}</p>
  const devices = (list.data?.devices ?? []).filter((d) => !onView.has(d.id))
  if (devices.length === 0)
    return (
      <p className="px-1 py-4 text-center text-muted-foreground">
        {q ? t('library.noMatch') : t('library.allDrawn')}
      </p>
    )
  return (
    <>
      <ul className="space-y-0.5">
        {devices.map((d) => (
          <Entry
            key={d.id}
            item={{
              kind: 'device',
              device: {
                id: d.id,
                hostname: d.hostname,
                type: d.type,
                siteId: d.siteId,
                mgmtIp: d.mgmtIp,
                model: d.model,
                siteCode: d.siteCode,
                managed: d.managed,
              },
            }}
            icon={icon(d.type)}
            title={d.hostname}
            detail={[d.siteCode, d.mgmtIp, d.model].filter(Boolean).join(' · ')}
            label={t('library.addExisting', { name: d.hostname })}
            onPick={onPick}
          />
        ))}
      </ul>
      {(list.data?.total ?? 0) > INVENTORY_PAGE && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">{t('library.narrow')}</p>
      )}
    </>
  )
}
