import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { DEVICE_GROUP_ORDER, templatesByGroup } from '../catalog/catalog'
import { DeviceIcon } from '../catalog/icons'
import type { DeviceGroup } from '../catalog/types'

export const DEVICE_MIME = 'application/ntb-device'

/**
 * Left sidebar: device templates grouped per SRS §2, with a search box.
 * Items are dragged onto the canvas (HTML5 drag & drop, see CanvasView.onDrop).
 */
export function Palette() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (group: DeviceGroup) =>
      templatesByGroup(group).filter(
        (tpl) => q === '' || tpl.label.toLowerCase().includes(q) || tpl.typeId.includes(q),
      )
    return DEVICE_GROUP_ORDER.map((group) => ({ group, templates: match(group) })).filter(
      ({ templates }) => templates.length > 0,
    )
  }, [query])

  return (
    <aside
      aria-label={t('editor.palette')}
      className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card"
    >
      <div className="border-b border-border p-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('editor.searchDevices')}
          aria-label={t('editor.searchDevices')}
        />
      </div>
      {/* Focusable so the list scrolls by keyboard; adding by keyboard comes with "/" quick-add (ADR-020, P1-13). */}
      <div
        tabIndex={0}
        aria-label={t('editor.palette')}
        className="flex-1 overflow-y-auto p-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {filtered.length === 0 && (
          <p className="px-1 py-4 text-center text-muted-foreground">{t('editor.noDevices')}</p>
        )}
        {filtered.map(({ group, templates }) => (
          <section key={group} className="mb-3">
            <h2 className="px-1 pb-1 text-label font-medium text-muted-foreground">
              {t(`editor.groups.${group}`)}
            </h2>
            <ul className="space-y-0.5">
              {templates.map((tpl) => (
                <li key={tpl.typeId}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DEVICE_MIME, tpl.typeId)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className="flex h-8 cursor-grab items-center gap-2 rounded-md px-2 hover:bg-muted active:cursor-grabbing"
                    title={t('editor.dragHint', { label: tpl.label })}
                  >
                    <DeviceIcon
                      typeId={tpl.typeId}
                      size={20}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{tpl.label}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}
