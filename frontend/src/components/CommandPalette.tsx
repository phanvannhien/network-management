import { LayoutDashboard, Network, Server, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { SAMPLE_DEVICES } from '@/modules/inventory/sampleDevices'

/**
 * Ctrl+K: jump to pages and devices by hostname / IP / S/N. Device search runs on the sample
 * inventory until the search API exists (P1-08).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { orgId } = useParams()
  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }
  const base = orgId ? `/o/${orgId}` : null

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
          {base && (
            <CommandGroup heading={t('palette.pages')}>
              <CommandItem onSelect={() => go(base)}>
                <LayoutDashboard aria-hidden /> {t('nav.dashboard')}
              </CommandItem>
              <CommandItem onSelect={() => go(`${base}/devices`)}>
                <Server aria-hidden /> {t('nav.devices')}
              </CommandItem>
              <CommandItem onSelect={() => go('/editor')}>
                <Network aria-hidden /> {t('nav.diagrams')}
              </CommandItem>
              <CommandItem onSelect={() => go(`${base}/members`)}>
                <Users aria-hidden /> {t('nav.members')}
              </CommandItem>
            </CommandGroup>
          )}
          {base && (
            <CommandGroup heading={t('palette.devices')}>
              {SAMPLE_DEVICES.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.hostname} ${d.mgmtIp} ${d.serial}`}
                  onSelect={() => go(`${base}/devices/${d.id}`)}
                >
                  <Server aria-hidden />
                  <span className="font-medium">{d.hostname}</span>
                  <span className="ml-auto font-mono text-tech text-muted-foreground">
                    {d.mgmtIp}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
