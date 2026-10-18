import { MoreHorizontal, Plus } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { pageLabel, type DiagramPage, type PageLayer } from '../doc/pages'

/**
 * Tabs of the diagram's pages at the bottom of the canvas (P2-08, like sheets in a workbook): pick a page, add one,
 * double-click to rename; the current tab's menu duplicates, reorders, sets how it opens (L1 / L2) or removes it.
 */
export function PageTabs({
  pages,
  current,
  canEdit,
  counts,
  left,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onLayer,
  onMove,
  onRemove,
}: {
  pages: DiagramPage[]
  current: string
  canEdit: boolean
  /** Objects drawn on each page (shown in the remove confirmation). */
  counts: Record<string, number>
  /** Room taken by the library on the left. */
  left: number
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onLayer: (id: string, layer: PageLayer) => void
  onMove: (id: string, delta: -1 | 1) => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<DiagramPage | null>(null)
  const index = pages.findIndex((p) => p.id === current)
  const page = pages[index]

  const startRename = (p: DiagramPage, i: number) => {
    if (!canEdit) return
    setDraft(pageLabel(p, i, t))
    setRenaming(p.id)
  }
  const commit = () => {
    const name = draft.trim()
    if (renaming && name) onRename(renaming, name.slice(0, 80))
    setRenaming(null)
  }
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
    if (next < 0 || next >= pages.length) return
    e.preventDefault()
    onSelect(pages[next]!.id)
    document.getElementById(`page-tab-${pages[next]!.id}`)?.focus()
  }

  return (
    <div
      className="absolute bottom-3 z-10 flex max-w-[60%] items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left }}
    >
      <div
        role="tablist"
        aria-label={t('pages.title')}
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
      >
        {pages.map((p, i) =>
          renaming === p.id ? (
            <Input
              key={p.id}
              autoFocus
              aria-label={t('pages.rename')}
              value={draft}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(null)
                e.stopPropagation()
              }}
              className="h-7 w-36 text-xs"
            />
          ) : (
            <button
              key={p.id}
              id={`page-tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={p.id === current}
              tabIndex={p.id === current ? 0 : -1}
              title={canEdit ? t('pages.renameHint') : undefined}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => startRename(p, i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'h-7 max-w-40 shrink-0 truncate rounded-md px-2 text-xs',
                p.id === current
                  ? 'bg-muted font-semibold'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              {pageLabel(p, i, t)}
              {p.layer !== 'physical' && (
                <span className="ml-1 rounded-sm border border-border px-0.5 text-[10px] font-normal">
                  {p.layer.toUpperCase()}
                </span>
              )}
            </button>
          ),
        )}
      </div>
      {canEdit && page && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('pages.menu', { name: pageLabel(page, index, t) })}
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem onClick={() => startRename(page, index)}>
              {t('pages.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(page.id)}>
              {t('pages.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={page.layer === 'physical'}
              onClick={() => onLayer(page.id, 'physical')}
            >
              {t('pages.opensL1')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={page.layer === 'l2'} onClick={() => onLayer(page.id, 'l2')}>
              {t('pages.opensL2')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index <= 0} onClick={() => onMove(page.id, -1)}>
              {t('pages.moveLeft')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index >= pages.length - 1}
              onClick={() => onMove(page.id, 1)}
            >
              {t('pages.moveRight')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={pages.length < 2}
              onClick={() => setRemoving(page)}
            >
              {t('pages.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canEdit && pages.length < 50 && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('pages.add')}
          title={t('pages.add')}
          onClick={onAdd}
        >
          <Plus aria-hidden />
        </Button>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('pages.removeTitle', { name: removing ? removing.name : '' })}
        description={t('pages.removeHint', { count: removing ? (counts[removing.id] ?? 0) : 0 })}
        confirmLabel={t('pages.remove')}
        onConfirm={() => {
          if (removing) onRemove(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}
