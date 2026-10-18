import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useParams } from 'react-router'
import { useSession } from '@/app/auth'
import { NotFoundPage } from '@/app/NotFoundPage'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { PageHeader } from '@/components/PageHeader'
import { Input } from '@/components/ui/input'
import { ShortcutsList } from '@/editor/workspace/ShortcutsDialog'
import { searchArticles, visibleArticles, type HelpArticle, type HelpSection } from './articles'
import { GLOSSARY } from './glossary'
import { Markdown, slugify } from './markdown'

const SECTIONS: HelpSection[] = ['start', 'guides', 'admin']

/** Live components an article can place with ":::name". */
const DIRECTIVES = { shortcuts: <ShortcutsList /> }

function useArticles() {
  const session = useSession()
  return useMemo(
    () => visibleArticles(session.data?.user.isSystemAdmin === true),
    [session.data?.user.isSystemAdmin],
  )
}

/** Help home (P2-24): search everything, or browse by section. */
export function HelpHome() {
  const { t, i18n } = useTranslation()
  const articles = useArticles()
  const [q, setQ] = useState('')
  useBreadcrumbs([])
  const lang = i18n.language.startsWith('en') ? 'en' : 'vi'
  const hits = useMemo(() => searchArticles(articles, q), [articles, q])
  const words = slugify(q)
    .split('-')
    .filter((w) => w.length > 1)
  const terms = words.length
    ? GLOSSARY.filter((g) =>
        words.every((w) => slugify(`${g.term.vi} ${g.term.en} ${g.what[lang]}`).includes(w)),
      ).slice(0, 8)
    : []

  return (
    <div className="max-w-4xl space-y-4 p-4">
      <PageHeader title={t('helpCenter.title')} description={t('helpCenter.intro')} />
      <div className="relative max-w-xl">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          type="search"
          autoFocus
          className="pl-8"
          aria-label={t('helpCenter.search')}
          placeholder={t('helpCenter.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {q.trim() ? (
        <section aria-label={t('helpCenter.results')} className="space-y-3">
          {hits.length === 0 && terms.length === 0 && (
            <p className="text-muted-foreground">{t('helpCenter.noResults')}</p>
          )}
          {hits.map((h) => (
            <Link
              key={h.article.slug}
              to={`/help/${h.article.slug}${h.anchor ? `#${h.anchor}` : ''}`}
              className="block rounded-lg border border-border bg-card p-3 hover:border-primary"
            >
              <span className="font-medium">{h.article.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{h.snippet}</span>
            </Link>
          ))}
          {terms.length > 0 && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t('helpCenter.terms')}</h2>
              {terms.map((g) => (
                <Link
                  key={g.id}
                  to={`/help/glossary#${g.id}`}
                  className="block text-sm text-primary hover:underline"
                >
                  {g.term[lang]}
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {SECTIONS.map((sec) => {
            const list = articles.filter((a) => a.section === sec)
            if (list.length === 0) return null
            return (
              <section key={sec} aria-label={t(`helpCenter.sections.${sec}`)} className="space-y-2">
                <h2 className="text-base font-semibold">{t(`helpCenter.sections.${sec}`)}</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((a) => (
                    <Link
                      key={a.slug}
                      to={`/help/${a.slug}`}
                      className="rounded-lg border border-border bg-card p-3 hover:border-primary"
                    >
                      <span className="font-medium">{a.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{a.summary}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">{t('helpCenter.sections.glossary')}</h2>
            <Link
              to="/help/glossary"
              className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 hover:border-primary"
            >
              <BookOpen aria-hidden className="size-4 text-primary" />
              <span>
                <span className="font-medium">{t('help.glossary')}</span>
                <span className="block text-sm text-muted-foreground">
                  {t('helpCenter.glossaryBlurb', { count: GLOSSARY.length })}
                </span>
              </span>
            </Link>
          </section>
        </>
      )}
    </div>
  )
}

/** One article: content, table of contents, previous / next. */
export function HelpArticlePage() {
  const { t } = useTranslation()
  const { slug = '' } = useParams()
  const { hash } = useLocation()
  const articles = useArticles()
  const article: HelpArticle | undefined = articles.find((a) => a.slug === slug)
  useBreadcrumbs([{ label: article?.title ?? '…' }])
  useEffect(() => {
    const id = decodeURIComponent(hash.replace('#', ''))
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
    else document.getElementById('main')?.scrollTo?.({ top: 0 })
  }, [hash, slug])
  // Admin articles stay hidden (404) from other users, like the pages they explain.
  if (!article) return <NotFoundPage inShell />
  const at = articles.indexOf(article)
  const prev = articles[at - 1]
  const next = articles[at + 1]
  const toc = article.headings.filter((h) => h.level === 2)

  return (
    <div className="flex gap-8 p-4">
      <article className="max-w-3xl min-w-0 flex-1 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t(`helpCenter.sections.${article.section}`)}
        </p>
        <h1 className="text-2xl font-semibold">{article.title}</h1>
        <Markdown blocks={article.blocks} components={DIRECTIVES} />
        <nav
          aria-label={t('helpCenter.more')}
          className="flex justify-between gap-4 border-t border-border pt-4 text-sm"
        >
          {prev ? (
            <Link
              to={`/help/${prev.slug}`}
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <ArrowLeft aria-hidden className="size-4" /> {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to={`/help/${next.slug}`}
              className="flex items-center gap-1 text-primary hover:underline"
            >
              {next.title} <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
        </nav>
      </article>
      {toc.length > 2 && (
        <nav
          aria-label={t('helpCenter.toc')}
          className="sticky top-4 hidden w-56 shrink-0 self-start text-sm xl:block"
        >
          <p className="mb-2 font-medium">{t('helpCenter.toc')}</p>
          <ul className="space-y-1">
            {toc.map((h) => (
              <li key={h.id}>
                <Link to={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
                  {h.text.replace(/`|\*\*/g, '')}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
