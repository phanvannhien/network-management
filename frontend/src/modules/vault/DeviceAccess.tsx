import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SecretField } from './SecretField'
import { CloudDialog, CredentialDialog } from './VaultDialogs'
import { useCloudAccounts, useCredentials, useVaultRights } from './vault'
import { Button } from '@/components/ui/button'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'

/** Device › access (P2-02 / P2-03): how to log in to it and which cloud account manages it. */
export function DeviceAccess({
  orgId,
  deviceId,
  hostname,
}: {
  orgId: string
  deviceId: string
  hostname: string
}) {
  const { t } = useTranslation()
  const rights = useVaultRights(orgId)
  const creds = useCredentials(orgId, '', deviceId)
  const clouds = useCloudAccounts(orgId, '', deviceId)
  const [adding, setAdding] = useState<'credential' | 'cloud' | null>(null)
  const here = [{ id: deviceId, hostname }]
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-3"
        aria-label={t('vault.credentialsTab')}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t('vault.credentialsTab')}</h3>
          {rights.canManage && (
            <Button size="sm" variant="outline" onClick={() => setAdding('credential')}>
              <Plus aria-hidden /> {t('vault.addCredential')}
            </Button>
          )}
        </div>
        {(creds.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vault.noneForDevice')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {(creds.data ?? []).map((c) => (
              <li key={c.id} className="space-y-0.5 py-2">
                <Link
                  to={`/o/${orgId}/vault?credential=${c.id}`}
                  className="font-medium hover:underline"
                >
                  {c.name}
                </Link>
                <span className="ml-2 text-muted-foreground">{t(`vault.kinds.${c.kind}`)}</span>
                <div className="flex flex-wrap items-center gap-x-3">
                  <span className="font-mono">{c.username || '—'}</span>
                  <SecretField
                    orgId={orgId}
                    target={{ credentialId: c.id }}
                    hasSecret={c.hasSecret}
                    canReveal={rights.canReveal}
                    label={c.name}
                  />
                  {c.rotateDue && (
                    <span className="text-xs">
                      {t('vault.rotateDue')}: <WarrantyText date={c.rotateDue} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-3"
        aria-label={t('vault.cloudTab')}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t('vault.cloudTab')}</h3>
          {rights.canManage && (
            <Button size="sm" variant="outline" onClick={() => setAdding('cloud')}>
              <Plus aria-hidden /> {t('vault.addCloud')}
            </Button>
          )}
        </div>
        {(clouds.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vault.noCloudForDevice')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {(clouds.data ?? []).map((a) => (
              <li key={a.id} className="space-y-0.5 py-2">
                <Link
                  to={`/o/${orgId}/vault?tab=cloud&account=${a.id}`}
                  className="font-medium hover:underline"
                >
                  {a.name}
                </Link>
                <span className="ml-2 text-muted-foreground">
                  {t(`vault.providers.${a.provider}`)}
                </span>
                <div className="flex flex-wrap items-center gap-x-3">
                  <span>{a.username || '—'}</span>
                  <SecretField
                    orgId={orgId}
                    target={{ accountId: a.id }}
                    hasSecret={a.hasSecret}
                    canReveal={rights.canReveal}
                    label={a.name}
                  />
                </div>
                {a.mfaHolder && (
                  <p className="text-xs text-muted-foreground">
                    {t('vault.mfaHolder')}: {a.mfaHolder}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {adding === 'credential' && (
        <CredentialDialog orgId={orgId} initialDevices={here} onClose={() => setAdding(null)} />
      )}
      {adding === 'cloud' && (
        <CloudDialog orgId={orgId} initialDevices={here} onClose={() => setAdding(null)} />
      )}
    </div>
  )
}
