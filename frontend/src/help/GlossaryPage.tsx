import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { PageHeader } from '@/components/PageHeader'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { GLOSSARY, type GlossaryGroup } from './glossary'

const GROUPS: GlossaryGroup[] = ['device', 'port', 'vlan', 'ip', 'cluster', 'org']

/** In-app glossary (DESIGN.md §4a): every networking term the product uses, in plain words, searchable. */
export function GlossaryPage() {
  const { t, i18n } = useTranslation()
  const { hash } = useLocation()
  const [q, setQ] = useState('')
  const lang = i18n.language.startsWith('en') ? 'en' : 'vi'
  const target = decodeURIComponent(hash.replace('#', ''))
  useBreadcrumbs([{ label: t('help.glossary') }])
  const needle = q.trim().toLowerCase()
  const entries = useMemo(
    () =>
      GLOSSARY.filter(
        (g) =>
          !needle ||
          [g.term.vi, g.term.en, g.what[lang]].some((v) => v.toLowerCase().includes(needle)),
      ),
    [needle, lang],
  )
  useEffect(() => {
    if (target) document.getElementById(`term-${target}`)?.scrollIntoView({ block: 'center' })
  }, [target])

  return (
    <div className="max-w-4xl space-y-4 p-4">
      <PageHeader title={t('help.glossary')} />
      <p className="text-muted-foreground">{t('help.glossaryIntro')}</p>
      <Input
        type="search"
        aria-label={t('help.search')}
        placeholder={t('help.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      {GROUPS.map((group) => {
        const items = entries.filter((g) => g.group === group)
        if (items.length === 0) return null
        return (
          <section key={group} aria-labelledby={`group-${group}`} className="space-y-2">
            <h2 id={`group-${group}`} className="text-sm font-semibold">
              {t(`help.groups.${group}`)}
            </h2>
            <dl className="divide-y divide-border rounded-lg border border-border bg-card">
              {items.map((g) => (
                <div
                  key={g.id}
                  id={`term-${g.id}`}
                  className={cn(
                    'grid gap-1 px-3 py-2 sm:grid-cols-[220px_1fr]',
                    g.id === target && 'bg-primary/5',
                  )}
                >
                  <dt className="font-medium">{g.term[lang]}</dt>
                  <dd className="space-y-0.5">
                    <p>{g.what[lang]}</p>
                    {g.example && (
                      <p className="text-muted-foreground">
                        {t('help.example')}: {g.example[lang]}
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}
      {entries.length === 0 && <p className="text-muted-foreground">{t('help.noMatch')}</p>}
    </div>
  )
}
