import type { TFunction } from 'i18next'
import type { components } from '@/api/client'

type Wan = components['schemas']['SiteWan']
type Edge = components['schemas']['SiteEdge']

// Overview labels (P2-21): the server sends service codes, the client words them in the user's language.

/** "VNPT · Internet 300M ×2" */
export function wanLabel(w: Wan, t: TFunction): string {
  const what = [t(`overview.services.${w.service}` as 'overview.services.vpn'), w.bandwidth]
    .filter(Boolean)
    .join(' ')
  return [w.provider, what].filter(Boolean).join(' · ') + (w.count > 1 ? ` ×${w.count}` : '')
}

/** "VPN/IPsec +1", "MPLS 20M" */
export function edgeLabel(e: Edge, t: TFunction): string {
  const name =
    e.service === 'vpn' && e.medium
      ? e.medium
      : t(`overview.services.${e.service}` as 'overview.services.vpn')
  return [name, e.bandwidth].filter(Boolean).join(' ') + (e.more > 0 ? ` +${e.more}` : '')
}
