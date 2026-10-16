import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Network,
  Search,
  Server,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router'
import { useLogout, useSession } from '@/app/auth'
import { activateOrganization, useMyOrganizations, useOrganization } from '@/app/orgs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePreferences, type Density, type Theme } from '@/lib/preferences'
import { cn } from '@/lib/utils'
import { useCrumbStore } from './breadcrumbs'
import { CommandPalette } from './CommandPalette'
import { EnvBadge } from './EnvBadge'
import { OrgAvatar, SystemAvatar } from './OrgAvatar'
import { SessionExpiryWarning } from './SessionExpiryWarning'

const WIDE_QUERY = '(min-width: 1440px)'

/** Sidebar collapses to icons below 1440px; the user can still expand it until the width changes. */
function useSidebarCollapsed() {
  const wide = () => globalThis.matchMedia?.(WIDE_QUERY).matches ?? true
  const [collapsed, setCollapsed] = useState(() => !wide())
  useEffect(() => {
    const mq = globalThis.matchMedia?.(WIDE_QUERY)
    if (!mq) return
    const onChange = () => setCollapsed(!mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return [collapsed, setCollapsed] as const
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

function SideNav({
  groups,
  collapsed,
}: {
  groups: { label?: string; items: NavItem[] }[]
  collapsed: boolean
}) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.main')} className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-0.5">
          {g.label &&
            (collapsed ? (
              <div className="mx-2 my-2 h-px bg-border" aria-hidden />
            ) : (
              <p className="px-2 pb-1 text-label font-medium text-muted-foreground">{g.label}</p>
            ))}
          {g.items.map((item) => {
            const link = (
              <NavLink
                to={item.to}
                end={item.end}
                aria-label={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground',
                    isActive &&
                      'bg-[color-mix(in_srgb,var(--brand)_12%,var(--surface))] font-medium text-foreground shadow-[inset_2px_0_0_var(--brand)]',
                    collapsed && 'justify-center px-0',
                  )
                }
              >
                <item.icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            )
            return collapsed ? (
              <Tooltip key={item.to}>
                <TooltipTrigger render={link} />
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.to}>{link}</div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

/** Current organization, always visible; a menu to switch only when there is more than one. */
function OrgSwitcher({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const orgs = useMyOrganizations()
  const org = useOrganization(orgId)
  const name = org.data?.organization.name ?? orgs.data?.find((o) => o.id === orgId)?.name ?? ''
  const label = (
    <>
      <OrgAvatar id={orgId} name={name} />
      <span className="max-w-56 truncate font-semibold">{name}</span>
    </>
  )
  if (!orgs.data || orgs.data.length < 2) {
    return (
      <span className="flex items-center gap-2" aria-label={t('topbar.currentOrg', { name })}>
        {label}
      </span>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="-ml-1.5 gap-2 px-1.5" />}>
        <span className="sr-only">{`${t('topbar.switchOrg')}:`}</span>
        {label}
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('topbar.yourOrgs')}</DropdownMenuLabel>
          {orgs.data.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onClick={() => {
                activateOrganization(o.id)
                navigate(`/o/${o.id}`)
              }}
              className={cn('gap-2', o.id === orgId && 'font-semibold')}
            >
              <OrgAvatar id={o.id} name={o.name} size="sm" />
              <span className="truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Breadcrumbs() {
  const { t } = useTranslation()
  const crumbs = useCrumbStore((s) => s.crumbs)
  if (crumbs.length === 0) return null
  return (
    <nav aria-label={t('nav.breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight aria-hidden className="size-3.5 shrink-0" />
              {c.to && !last ? (
                <Link to={c.to} className="truncate hover:text-foreground hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn('truncate', last && 'text-foreground')}
                >
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function AccountMenu() {
  const { t } = useTranslation()
  const session = useSession()
  const logout = useLogout()
  const { theme, density, setTheme, setDensity } = usePreferences()
  const user = session.data?.user
  if (!user) return null
  const initials = (user.displayName || user.email).slice(0, 2).toUpperCase()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground ring-1 ring-border-control"
        >
          {initials}
        </span>
        <span className="sr-only">{`${t('topbar.account')}: ${user.displayName || user.email}`}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block font-medium text-foreground">
              {user.displayName || user.email}
            </span>
            <span className="block text-muted-foreground">{user.email}</span>
            {user.isSystemAdmin && (
              <span className="block text-muted-foreground">{t('topbar.systemAdmin')}</span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('topbar.theme')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <DropdownMenuRadioItem value="light">{t('topbar.themeLight')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">{t('topbar.themeDark')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">{t('topbar.themeSystem')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('topbar.density')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
            <DropdownMenuRadioItem value="compact">
              {t('topbar.densityCompact')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="comfortable">
              {t('topbar.densityComfortable')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/mfa/setup?next=/" />}>
          {t('topbar.mfa')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => logout.mutate()}>{t('topbar.signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Notifications() {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label={t('topbar.notifications')} />}
      >
        <Bell aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-muted-foreground">
        {t('topbar.noNotifications')}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Application frame (DESIGN.md §6): collapsible sidebar, topbar with the current organization (or
 * the system-area band), breadcrumb, Ctrl+K, notifications, account menu, session-expiry warning.
 */
function Shell({
  area,
  nav,
  children,
}: {
  area: ReactNode
  nav: { label?: string; items: NavItem[] }[]
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useSidebarCollapsed()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <aside
          className="flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-100"
          style={{ width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)' }}
        >
          <div
            className={cn(
              'flex h-(--topbar-h) items-center gap-2 border-b border-border px-3',
              collapsed && 'justify-center px-0',
            )}
          >
            <Network aria-hidden className="size-5 shrink-0 text-primary" strokeWidth={2} />
            {!collapsed && <span className="truncate font-semibold">{t('common.product')}</span>}
          </div>
          {!collapsed ? (
            <div className="px-3 pt-2 empty:hidden">
              <EnvBadge />
            </div>
          ) : (
            <div className="grid place-items-center pt-2 empty:hidden">
              <EnvBadge compact />
            </div>
          )}
          <SideNav groups={nav} collapsed={collapsed} />
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              className={cn(
                'w-full justify-start text-muted-foreground',
                collapsed && 'justify-center',
              )}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
              {!collapsed && t('nav.collapse')}
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="relative flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-border bg-card px-4">
            {area}
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                className="w-64 justify-start gap-2 font-normal text-muted-foreground"
                onClick={() => setPaletteOpen(true)}
                aria-keyshortcuts="Control+K"
              >
                <Search aria-hidden />
                <span className="flex-1 truncate text-left">{t('topbar.search')}</span>
                <kbd className="rounded-sm border border-border px-1 font-mono text-[11px]">
                  Ctrl K
                </kbd>
              </Button>
              <Notifications />
              <AccountMenu />
            </div>
          </header>
          <SessionExpiryWarning />
          <main id="main" className="min-h-0 flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TooltipProvider>
  )
}

/** Shell for /o/:orgId/… pages. */
export function OrgShell() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const session = useSession()
  const org = useOrganization(orgId)
  const base = `/o/${orgId}`
  // Unfinished modules (IPAM, Sites, …) stay hidden until they ship (PLAN P1-06).
  const nav = [
    {
      items: [
        { to: base, label: t('nav.dashboard'), icon: LayoutDashboard, end: true },
        { to: '/editor', label: t('nav.diagrams'), icon: Network },
        { to: `${base}/devices`, label: t('nav.devices'), icon: Server },
      ],
    },
    {
      label: t('nav.admin'),
      items: [
        { to: `${base}/members`, label: t('nav.members'), icon: Users },
        ...(session.data?.user.isSystemAdmin
          ? [{ to: '/admin/organizations', label: t('nav.system'), icon: ShieldCheck }]
          : []),
      ],
    },
  ]

  useEffect(() => {
    if (org.data) activateOrganization(orgId)
  }, [orgId, org.data])

  return (
    <Shell area={<OrgSwitcher orgId={orgId} />} nav={nav}>
      <Outlet />
    </Shell>
  )
}

/** Shell for /admin/… (system admin): distinct band + label so it is never mistaken for an org. */
export function SystemShell() {
  const { t } = useTranslation()
  const nav = [
    {
      label: t('nav.system'),
      items: [
        { to: '/admin/organizations', label: t('nav.systemOrganizations'), icon: Building2 },
        { to: '/admin/users', label: t('nav.systemUsers'), icon: Users },
      ],
    },
  ]
  return (
    <Shell
      nav={nav}
      area={
        <>
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-system" />
          <span className="flex items-center gap-2">
            <SystemAvatar />
            <span className="rounded-sm bg-system px-1.5 py-0.5 text-[12px] font-semibold text-system-fg">
              {t('nav.system')}
            </span>
            <span className="sr-only">{t('topbar.systemArea')}</span>
          </span>
        </>
      }
    >
      <Outlet />
    </Shell>
  )
}
