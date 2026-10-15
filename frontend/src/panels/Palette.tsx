import { useMemo, useState } from 'react'
import { DEVICE_GROUP_LABELS, DEVICE_GROUP_ORDER, templatesByGroup } from '../catalog/catalog'
import { DeviceIcon } from '../catalog/icons'
import type { DeviceGroup } from '../catalog/types'

export const DEVICE_MIME = 'application/ntb-device'

/**
 * Left sidebar: device templates grouped per SRS §2, with a search box.
 * Items are dragged onto the canvas (HTML5 drag & drop, see CanvasView.onDrop).
 */
export function Palette() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (group: DeviceGroup) =>
      templatesByGroup(group).filter(
        (t) => q === '' || t.label.toLowerCase().includes(q) || t.typeId.includes(q),
      )
    return DEVICE_GROUP_ORDER.map((group) => ({ group, templates: match(group) })).filter(
      ({ templates }) => templates.length > 0,
    )
  }, [query])

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-background">
      <div className="border-b border-border p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm thiết bị…"
          aria-label="Search devices"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            Không tìm thấy thiết bị nào
          </p>
        )}
        {filtered.map(({ group, templates }) => (
          <section key={group} className="mb-3">
            <h2 className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {DEVICE_GROUP_LABELS[group]}
            </h2>
            <ul className="space-y-0.5">
              {templates.map((t) => (
                <li key={t.typeId}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DEVICE_MIME, t.typeId)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent active:cursor-grabbing"
                    title={`${t.label} — kéo thả vào canvas`}
                  >
                    <DeviceIcon
                      typeId={t.typeId}
                      size={20}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{t.label}</span>
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
