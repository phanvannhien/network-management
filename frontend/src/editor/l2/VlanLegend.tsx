import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldHelp } from '@/components/FieldHelp'
import { cn } from '@/lib/utils'
import { useDoc } from '../workspace/context'
import { docOnPage } from '../doc/pages'
import { legendItems } from './legend'

/**
 * L2 view legend (P2-08): the VLANs on the diagram with their IPAM colour; clicking one picks it (cables carrying it
 * stand out, the rest fade), clicking it again clears the pick.
 */
export function VlanLegend({ left, bottom = 12 }: { left: number; bottom?: number }) {
  const { t } = useTranslation()
  // This page's cables only (P2-08).
  const doc = useDoc((s) => (s.doc ? docOnPage(s.doc, s.page) : null))
  const filter = useDoc((s) => s.vlanFilter)
  const setFilter = useDoc((s) => s.setVlanFilter)
  const items = useMemo(() => (doc ? legendItems(doc) : []), [doc])
  return (
    <section
      aria-label={t('l2.legend')}
      className="absolute z-10 max-h-[45vh] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
      style={{ left, bottom }}
    >
      <header className="mb-1 flex items-center gap-1">
        <h2 className="font-semibold">{t('l2.legend')}</h2>
        <FieldHelp term="vlan" />
        {filter && (
          <button
            type="button"
            className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setFilter(null)}
          >
            {t('l2.clearFilter')}
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('l2.legendEmpty')}</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  aria-pressed={filter === i.key}
                  onClick={() => setFilter(filter === i.key ? null : i.key)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-muted',
                    filter === i.key && 'bg-muted font-medium',
                  )}
                >
                  <span
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      i.unknown && 'border border-dashed border-muted-foreground',
                    )}
                    style={{ background: i.unknown ? 'transparent' : i.color }}
                    aria-hidden
                  />
                  <span className="font-mono tabular-nums">{i.vid}</span>
                  <span className={cn('truncate', i.unknown && 'text-muted-foreground italic')}>
                    {i.name || t('l2.notInIpam')}
                  </span>
                  {i.where && <span className="text-muted-foreground">· {i.where}</span>}
                  {i.gateway && (
                    <span className="ml-auto rounded-sm border border-border px-0.5 text-[10px]">
                      GW
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {filter ? t('l2.maybe') : t('l2.legendHint')}
          </p>
        </>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{t('l2.hidden')}</p>
    </section>
  )
}
