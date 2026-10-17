import {
  Activity,
  Boxes,
  Building2,
  Cable,
  Combine,
  FolderTree,
  Languages,
  LayoutDashboard,
  MapPin,
  Moon,
  Network,
  Fingerprint,
  ScrollText,
  Server,
  Sun,
  User,
  Users,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useSession } from '@/app/auth'
import { SEARCH_MIN, useDebounced, useGlobalSearch, type SearchResult } from '@/app/search'
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
import { useCategories, useSites } from '@/modules/sites/sites'
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

/** Lower case without Vietnamese accents, so "ha noi" finds "Hà Nội". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()

/** Every word typed appears in the entry's text (no fuzzy letter-skipping: "cjidc" must not find "CJ Foodville"). */
function matches(_value: string, search: string, keywords?: string[]): number {
  const text = fold((keywords ?? []).join(' '))
  return fold(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w))
    ? 1
    : 0
}

type Diagrams = SearchResult['devices'][number]['diagrams']

/**
 * Ctrl+K (SRS §2): pages the user may open, organizations to switch to, categories, sites, members and a few commands
 * are matched in the browser; from two characters on, the global search (P1-23) adds devices (hostname, S/N, part
 * number, model), clusters, addresses, MACs and endpoint groups, each with "open on the diagram" when one shows it.
 * Data is only fetched while the palette is open.
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
  const sites = useSites(orgId, open)
  const categories = useCategories(orgId, open)
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const found = useGlobalSearch(open ? orgId : '', query)
  const hits = query.length >= SEARCH_MIN ? found.data : undefined
  const { theme, setTheme } = usePreferences()
  const isSysAdmin = session.data?.user.isSystemAdmin ?? false
  const role = org.data?.membership.role
  const members = useMembers(open && role ? orgId : '')
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
          {
            key: 'diagrams',
            label: t('nav.diagrams'),
            icon: <Network />,
            run: go(`${base}/diagrams`),
          },
          ...(role
            ? [
                {
                  key: 'members',
                  label: t('nav.members'),
                  icon: <Users />,
                  run: go(`${base}/members`),
                },
              ]
            : []),
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

  const categoryEntries: Entry[] = base
    ? (categories.data ?? []).map((c) => ({
        key: `c-${c.id}`,
        label: c.path,
        hint: <span className="font-mono text-tech text-muted-foreground">{c.code}</span>,
        icon: <FolderTree />,
        run: go(`${base}/sites?category=${c.id}`),
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

  // Server hits always carry the query in their matched text, so the palette's own filter keeps them.
  const mono = (text: string) => (
    <span className="font-mono text-tech text-muted-foreground">{text}</span>
  )
  /** "Open on <diagram>" entries for a hit placed on diagrams (the first three). */
  const onDiagrams = (key: string, label: string, refId: string, diagrams: Diagrams): Entry[] =>
    base
      ? diagrams.slice(0, 3).map((d) => ({
          key: `${key}-dg-${d.id}`,
          label: t('palette.openOn', { name: label, diagram: d.name }),
          keywords: query,
          icon: <Network />,
          run: go(`${base}/diagrams/${d.id}?focus=${refId}`),
        }))
      : []
  const devices: Entry[] =
    base && hits
      ? hits.devices.flatMap((d) => [
          {
            key: `d-${d.id}`,
            label: d.hostname,
            keywords: `${d.matchedValue} ${query}`,
            icon: <Server />,
            hint: mono(
              d.matched === 'hostname'
                ? d.siteCode
                : `${t(`palette.matched.${d.matched}`)}: ${d.matchedValue} · ${d.siteCode}`,
            ),
            run: go(`${base}/devices/${d.id}`),
          },
          ...onDiagrams(`d-${d.id}`, d.hostname, d.id, d.diagrams),
        ])
      : []
  const clusters: Entry[] =
    base && hits
      ? hits.clusters.flatMap((c) => {
          const shown = onDiagrams(`c-${c.id}`, c.name, c.id, c.diagrams)
          return shown.length > 0
            ? shown.map((e) => ({ ...e, icon: <Combine />, hint: mono(c.siteCode) }))
            : [
                {
                  key: `c-${c.id}`,
                  label: c.name,
                  keywords: query,
                  icon: <Combine />,
                  hint: mono(c.siteCode),
                  run: go(`${base}/devices?q=${encodeURIComponent(c.hostname || c.name)}`),
                },
              ]
        })
      : []
  /** Where an address / MAC hit leads: its device, else the diagram showing its cluster or group, else the group. */
  const holder = (h: {
    deviceId?: string
    clusterId?: string
    groupId?: string
    diagrams: Diagrams
  }): (() => void) => {
    if (h.deviceId) return go(`${base}/devices/${h.deviceId}`)
    const ref = h.clusterId ?? h.groupId
    if (ref && h.diagrams[0]) return go(`${base}/diagrams/${h.diagrams[0].id}?focus=${ref}`)
    if (h.groupId) return go(`${base}/endpoint-groups/${h.groupId}`)
    return go(`${base}/ipam`)
  }
  const addresses: Entry[] =
    base && hits
      ? hits.ips.flatMap((a) => [
          {
            key: `ip-${a.address}-${a.deviceId ?? a.clusterId ?? a.groupId}`,
            label: a.address,
            keywords: query,
            icon: <Fingerprint />,
            hint: mono([a.name, a.interfaceName, a.siteCode].filter(Boolean).join(' · ')),
            run: holder(a),
          },
          ...(a.deviceId ? onDiagrams(`ip-${a.address}`, a.name, a.deviceId, a.diagrams) : []),
        ])
      : []
  const macs: Entry[] =
    base && hits
      ? hits.macs.map((x) => ({
          key: `mac-${x.mac}-${x.deviceId ?? x.groupId}`,
          label: x.mac,
          keywords: query,
          icon: <Cable />,
          hint: mono([x.name, x.interfaceName].filter(Boolean).join(' · ')),
          run: holder(x),
        }))
      : []
  const groupHits: Entry[] =
    base && hits
      ? hits.groups.flatMap((g) => [
          {
            key: `g-${g.id}`,
            label: g.name,
            keywords: query,
            icon: <Boxes />,
            hint: mono(g.siteCode),
            run: go(`${base}/endpoint-groups/${g.id}`),
          },
          ...onDiagrams(`g-${g.id}`, g.name, g.id, g.diagrams),
        ])
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
    { heading: t('palette.categories'), entries: categoryEntries },
    { heading: t('palette.sites'), entries: siteEntries },
    { heading: t('palette.members'), entries: people },
    { heading: t('palette.devices'), entries: devices },
    { heading: t('palette.clusters'), entries: clusters },
    { heading: t('palette.addresses'), entries: addresses },
    { heading: t('palette.macs'), entries: macs },
    { heading: t('palette.groups'), entries: groupHits },
    { heading: t('palette.commands'), entries: commands },
  ]

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch('')
        onOpenChange(o)
      }}
      title={t('palette.title')}
      description={t('palette.description')}
      className="sm:max-w-xl"
    >
      <Command filter={matches}>
        <CommandInput
          placeholder={t('palette.placeholder')}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>
            {found.isFetching && search.trim().length >= SEARCH_MIN
              ? t('palette.searching')
              : t('palette.empty')}
          </CommandEmpty>
          {groups
            .filter((g) => g.entries.length > 0)
            .map((g) => (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.entries.map((e) => (
                  <CommandItem
                    key={e.key}
                    value={e.key}
                    keywords={[e.label, e.keywords ?? '']}
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
