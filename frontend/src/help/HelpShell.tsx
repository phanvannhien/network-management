import { ArrowLeft, BookOpen, CircleHelp, FileText, Rocket, ShieldCheck } from 'lucide-react'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { useSession } from '@/app/auth'
import { PageSkeleton, Shell } from '@/components/AppShell'
import { visibleArticles } from './articles'

/** Shell for /help/… (P2-24): articles by section; admin articles for system admins only. */
export function HelpShell() {
  const { t } = useTranslation()
  const session = useSession()
  const articles = visibleArticles(session.data?.user.isSystemAdmin === true)
  const icon = (section: string) => (section === 'start' ? Rocket : FileText)
  const group = (section: 'start' | 'guides' | 'admin') => ({
    label: t(`helpCenter.sections.${section}`),
    items: articles
      .filter((a) => a.section === section)
      .map((a) => ({
        to: `/help/${a.slug}`,
        label: a.title,
        icon: section === 'admin' ? ShieldCheck : icon(section),
      })),
  })
  const nav = [
    {
      items: [
        { to: '/help', label: t('helpCenter.title'), icon: CircleHelp, end: true },
        ...group('start').items,
      ],
    },
    group('guides'),
    { items: [{ to: '/help/glossary', label: t('help.glossary'), icon: BookOpen }] },
    group('admin'),
    { items: [{ to: '/', label: t('helpCenter.back'), icon: ArrowLeft, end: true }] },
  ].filter((g) => g.items.length > 0)
  return (
    <Shell
      nav={nav}
      area={
        <span className="flex items-center gap-2 font-semibold">
          <CircleHelp aria-hidden className="size-5 text-primary" /> {t('helpCenter.title')}
        </span>
      }
    >
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </Shell>
  )
}
