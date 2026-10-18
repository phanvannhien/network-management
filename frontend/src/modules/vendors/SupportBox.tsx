import { ExternalLink, Mail, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { VendorContact } from './vendors'

/** A web address safe to put in href: http(s) only (the server checks too). */
export function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

/** How to reach a vendor's support: hotline (tap to call), e-mail, portal, contact people (SRS §8). */
export function SupportBox({
  name,
  phone,
  email,
  portal,
  contacts = [],
}: {
  name?: string
  phone: string
  email: string
  portal: string
  contacts?: VendorContact[]
}) {
  const { t } = useTranslation()
  if (!phone && !email && !portal && contacts.length === 0)
    return <p className="text-sm text-muted-foreground">{t('vendors.noSupport')}</p>
  return (
    <div className="space-y-1 text-sm">
      {name && <p className="font-medium">{name}</p>}
      {phone && (
        <a href={`tel:${phone}`} className="flex items-center gap-1.5 hover:underline">
          <Phone aria-hidden className="size-3.5" /> {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="flex items-center gap-1.5 hover:underline">
          <Mail aria-hidden className="size-3.5" /> {email}
        </a>
      )}
      {portal && safeHref(portal) && (
        <a
          href={safeHref(portal)!}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 text-primary hover:underline"
        >
          <ExternalLink aria-hidden className="size-3.5" /> {t('vendors.openPortal')}
        </a>
      )}
      {contacts.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-border pt-1">
          {contacts.map((c) => (
            <li key={c.id}>
              {c.name}
              {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
              {c.phone && (
                <a href={`tel:${c.phone}`} className="ml-1 hover:underline">
                  {c.phone}
                </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="ml-1 hover:underline">
                  {c.email}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
