import {
  Activity,
  Building2,
  Handshake,
  Languages,
  LayoutDashboard,
  MapPin,
  Moon,
  Network,
  ScrollText,
  Server,
  Sun,
  User,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useSession } from '@/app/auth'
import { activateOrganization, useMyOrganizations, useOrganization } from '@/app/orgs'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { setLanguage } from '@/i18n'
import { usePreferences } from '@/lib/preferences'
import { useMembers } from '@/modules/admin/members'
import { SAMPLE_DEVICES } from '@/modules/inventory/sampleDevices'
import { useBusinessUnits, usePartners, useSites } from '@/modules/sites/sites'
import { OrgAvatar } from './OrgAvatar'

interface Entry {
  key: string
  label: string
  /** Extra text matched by the search (IP, email, S/N, …). */
  keywords?: string
  icon: ReactNode
  hint?: ReactNode
  run: () => void
}

/**
 * Ctrl+K (SRS §2): pages the user may open, organizations to switch to, members, devices and a few
 * commands. Each group is a provider; modules add theirs as they ship (devices use the sample
 * inventory until P1-08, then the search API). Data is only fetched while the palette is open.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { orgId = '' } = useParams()
  const session = useSession()
  const orgs = useMyOrganizations()
  const org = useOrganization(orgId)
  const members = useMembers(open ? orgId : '')
  const sites = useSites(orgId, open)
  const partners = usePartners(orgId, open)
  const units = useBusinessUnits(orgId, open)
  const { theme, setTheme } = usePreferences()
  const isSysAdmin = session.data?.user.isSystemAdmin ?? false
  const role = org.data?.membership.role
  const isAdmin = role === 'owner' || role === 'admin'

  const go = (to: string) => () => {
    onOpenChange(false)
    navigate(to)
  }
  const base = orgId ? `/o/${orgId}` : null

  const pages: Entry[] = [
    ...(base
      ? [
          { key: 'dash', label: t('nav.dashboard'), icon: <LayoutDashboard />, run: go(base) },
          { key: 'devices', label: t('nav.devices'), icon: <Server />, run: go(`${base}/devices`) },
          { key: 'sites', label: t('nav.sites'), icon: <MapPin />, run: go(`${base}/sites`) },
          { key: 'diagrams', label: t('nav.diagrams'), icon: <Network />, run: go('/editor') },
          { key: 'members', label: t('nav.members'), icon: <Users />, run: go(`${base}/members`) },
          ...(isAdmin
            ? [
                {
                  key: 'audit',
                  label: t('nav.audit'),
                  icon: <ScrollText />,
                  run: go(`${base}/audit`),
                },
              ]
            : []),
        ]
      : []),
    ...(isSysAdmin
      ? [
          {
            key: 's-orgs',
            label: `${t('nav.system')} › ${t('nav.systemOrganizations')}`,
            icon: <Building2 />,
            run: go('/admin/organizations'),
          },
          {
            key: 's-users',
            label: `${t('nav.system')} › ${t('nav.systemUsers')}`,
            icon: <Users />,
            run: go('/admin/users'),
          },
          {
            key: 's-audit',
            label: `${t('nav.system')} › ${t('nav.audit')}`,
            icon: <ScrollText />,
            run: go('/admin/audit'),
          },
          {
            key: 's-health',
            label: `${t('nav.system')} › ${t('nav.systemHealth')}`,
            icon: <Activity />,
            run: go('/admin/health'),
          },
        ]
      : []),
  ]

  const organizations: Entry[] = (orgs.data ?? [])
    .filter((o) => o.id !== orgId)
    .map((o) => ({
      key: `org-${o.id}`,
      label: o.name,
      icon: <OrgAvatar id={o.id} name={o.name} size="sm" />,
      run: () => {
        activateOrganization(o.id)
        go(`/o/${o.id}`)()
      },
    }))

  const people: Entry[] = base
    ? (members.data ?? []).map((m) => ({
        key: `m-${m.userId}`,
        label: m.displayName || m.email,
        keywords: m.email,
        icon: <User />,
        hint: <span className="text-muted-foreground">{m.email}</span>,
        run: go(`${base}/members?q=${encodeURIComponent(m.email)}`),
      }))
    : []

  const partnerEntries: Entry[] = base
    ? (partners.data ?? []).map((p) => ({
        key: `p-${p.id}`,
        label: `${p.code} · ${p.name}`,
        icon: <Handshake />,
        run: go(`${base}/partners/${p.id}`),
      }))
    : []

  // Unit codes repeat across partners (MAIN), so the label carries the partner code.
  const unitEntries: Entry[] = base
    ? (units.data ?? []).map((u) => ({
        key: `u-${u.id}`,
        label: `${u.partnerCode} › ${u.code} · ${u.name}`,
        icon: <Building2 />,
        run: go(`${base}/units/${u.id}`),
      }))
    : []

  const siteEntries: Entry[] = base
    ? (sites.data ?? []).map((st) => ({
        key: `s-${st.id}`,
        label: `${st.code} · ${st.name}`,
        keywords: st.address,
        icon: <MapPin />,
        run: go(`${base}/sites/${st.id}`),
      }))
    : []

  const devices: Entry[] = base
    ? SAMPLE_DEVICES.map((d) => ({
        key: `d-${d.id}`,
        label: d.hostname,
        keywords: [d.mgmtIp, d.mac, d.serial, d.partNumber, d.site].join(' '),
        icon: <Server />,
        hint: <span className="font-mono text-tech text-muted-foreground">{d.mgmtIp}</span>,
        run: go(`${base}/devices/${d.id}`),
      }))
    : []

  const dark = theme === 'dark'
  const commands: Entry[] = [
    {
      key: 'theme',
      label: dark ? t('palette.themeLight') : t('palette.themeDark'),
      icon: dark ? <Sun /> : <Moon />,
      run: () => setTheme(dark ? 'light' : 'dark'),
    },
    {
      key: 'lang',
      label: i18n.language.startsWith('en') ? 'Tiếng Việt' : 'English',
      icon: <Languages />,
      run: () => setLanguage(i18n.language.startsWith('en') ? 'vi' : 'en'),
    },
  ]

  const groups: { heading: string; entries: Entry[] }[] = [
    { heading: t('palette.pages'), entries: pages },
    { heading: t('palette.organizations'), entries: organizations },
    { heading: t('palette.partners'), entries: partnerEntries },
    { heading: t('palette.units'), entries: unitEntries },
    { heading: t('palette.sites'), entries: siteEntries },
    { heading: t('palette.members'), entries: people },
    { heading: t('palette.devicesSample'), entries: devices },
    { heading: t('palette.commands'), entries: commands },
  ]

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('palette.title')}
      description={t('palette.description')}
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput placeholder={t('palette.placeholder')} />
        <CommandList>
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          {groups
            .filter((g) => g.entries.length > 0)
            .map((g) => (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.entries.map((e) => (
                  <CommandItem
                    key={e.key}
                    value={`${e.label} ${e.keywords ?? ''} ${e.key}`}
                    onSelect={e.run}
                  >
                    <span aria-hidden className="grid size-4 place-items-center [&_svg]:size-4">
                      {e.icon}
                    </span>
                    <span className="font-medium">{e.label}</span>
                    {e.hint && <span className="ml-auto truncate">{e.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
