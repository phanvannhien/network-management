import { Bookmark, Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isFilterActive, type FilterState } from './filters'

export interface FacetOption {
  value: string
  label: string
  count?: number
}

export interface Facet {
  id: string
  label: string
  options: FacetOption[]
}

interface SavedFilter {
  name: string
  filter: FilterState
}

function useSavedFilters(storageKey: string) {
  const [saved, setSaved] = useState<SavedFilter[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as SavedFilter[]
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved))
    } catch {
      // not remembered
    }
  }, [storageKey, saved])
  return [saved, setSaved] as const
}

/** Multi-select facet in a popover; the trigger shows the selected value or a count. */
function FacetMenu({
  facet,
  selected,
  onChange,
}: {
  facet: Facet
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const { t } = useTranslation()
  const summary =
    selected.length === 0
      ? t('filter.all')
      : selected.length === 1
        ? (facet.options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length}`
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn('font-normal', selected.length > 0 && 'border-primary')}
          />
        }
      >
        <span className="text-muted-foreground">{facet.label}:</span> {summary}
        <ChevronDown aria-hidden className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div role="group" aria-label={facet.label}>
          {facet.options.map((o) => {
            const on = selected.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() =>
                  onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])
                }
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-muted"
              >
                <span
                  className={cn(
                    'grid size-4 place-items-center rounded-[4px] border border-input',
                    on && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {on && <Check aria-hidden className="size-3" />}
                </span>
                <span className="flex-1">{o.label}</span>
                {o.count !== undefined && (
                  <span data-numeric className="text-muted-foreground">
                    {o.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Search + facet filters + active chips + saved filters (DESIGN.md §7a). Saved filters are kept
 * per user and table in localStorage.
 */
export function FilterBar({
  value,
  onChange,
  facets,
  searchPlaceholder,
  storageKey,
}: {
  value: FilterState
  onChange: (value: FilterState) => void
  facets: Facet[]
  searchPlaceholder: string
  /** e.g. `ntb-filters:<userId>:devices`. */
  storageKey: string
}) {
  const { t } = useTranslation()
  const [saved, setSaved] = useSavedFilters(storageKey)
  const [naming, setNaming] = useState<string | null>(null)
  const setFacet = (id: string, values: string[]) =>
    onChange({ ...value, facets: { ...value.facets, [id]: values } })

  const chips = facets.flatMap((f) =>
    (value.facets[f.id] ?? []).map((v) => ({
      facet: f,
      value: v,
      label: `${f.label} = ${f.options.find((o) => o.value === v)?.label ?? v}`,
    })),
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={t('filter.search')}
            placeholder={searchPlaceholder}
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            className="pl-8"
          />
        </div>
        {facets.map((f) => (
          <FacetMenu
            key={f.id}
            facet={f}
            selected={value.facets[f.id] ?? []}
            onChange={(v) => setFacet(f.id, v)}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="ml-auto" />}>
            <Bookmark aria-hidden /> {t('filter.saved')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('filter.saved')}</DropdownMenuLabel>
              {saved.length === 0 && (
                <p className="px-2 py-1 text-muted-foreground">{t('filter.noSaved')}</p>
              )}
              {saved.map((s) => (
                <DropdownMenuItem key={s.name} onClick={() => onChange(s.filter)}>
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {isFilterActive(value) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setNaming('')}>
                  {t('filter.saveCurrent')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {naming !== null && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const name = naming.trim()
            if (!name) return
            setSaved([...saved.filter((s) => s.name !== name), { name, filter: value }])
            setNaming(null)
          }}
        >
          <Input
            autoFocus
            aria-label={t('filter.savedName')}
            placeholder={t('filter.savedName')}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            className="w-60"
          />
          <Button type="submit" size="sm">
            {t('common.save')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(null)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label={t('filter.active')}>
          <span className="text-muted-foreground">{t('filter.active')}:</span>
          {chips.map((c) => (
            <span
              key={`${c.facet.id}:${c.value}`}
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-muted pr-0.5 pl-2"
            >
              {c.label}
              <button
                type="button"
                aria-label={t('filter.remove', { label: c.label })}
                onClick={() =>
                  setFacet(
                    c.facet.id,
                    (value.facets[c.facet.id] ?? []).filter((v) => v !== c.value),
                  )
                }
                className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </span>
          ))}
          <Button variant="link" size="sm" onClick={() => onChange({ ...value, facets: {} })}>
            {t('filter.clear')}
          </Button>
        </div>
      )}
    </div>
  )
}
