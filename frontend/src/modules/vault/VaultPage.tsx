import { Cloud, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KeyValueList } from '@/components/KeyValueList'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { WarrantyText } from '@/modules/inventory/DeviceListPage'
import { safeHref } from '@/modules/vendors/SupportBox'
import { SecretField } from './SecretField'
import { CloudDialog, CredentialDialog } from './VaultDialogs'
import {
  useCloudAccount,
  useCloudAccounts,
  useCloudMutations,
  useCredential,
  useCredentialMutations,
  useCredentials,
  useVaultRights,
} from './vault'

/**
 * Password vault (P2-02 / P2-03, SRS §9): device credentials (SSH, web, console, enable, SNMP…) and cloud
 * management accounts (FortiCloud, Meraki, UniFi…). Secrets stay masked; showing or copying one needs the reveal
 * right and a recent MFA code, and is audited.
 */
export function VaultPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'cloud' ? 'cloud' : 'credentials'
  const openCredential = params.get('credential') ?? ''
  const openAccount = params.get('account') ?? ''
  const rights = useVaultRights(orgId)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<'credential' | 'cloud' | null>(null)
  useBreadcrumbs([{ label: t('vault.title') }])
  const creds = useCredentials(orgId, q, '', tab === 'credentials')
  const clouds = useCloudAccounts(orgId, q, '', tab === 'cloud')
  const open = (key: 'credential' | 'account', id: string) =>
    setParams(
      id
        ? { ...(tab === 'cloud' ? { tab: 'cloud' } : {}), [key]: id }
        : tab === 'cloud'
          ? { tab: 'cloud' }
          : {},
    )

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={t('vault.title')}
        description={t('vault.intro')}
        actions={
          rights.canManage && (
            <Button onClick={() => setAdding(tab === 'cloud' ? 'cloud' : 'credential')}>
              <Plus aria-hidden />{' '}
              {tab === 'cloud' ? t('vault.addCloud') : t('vault.addCredential')}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'cloud' ? { tab: 'cloud' } : {}, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="credentials">
            <KeyRound aria-hidden /> {t('vault.credentialsTab')}
          </TabsTrigger>
          <TabsTrigger value="cloud">
            <Cloud aria-hidden /> {t('vault.cloudTab')}
          </TabsTrigger>
        </TabsList>
        <Input
          className="mt-3 max-w-sm"
          aria-label={t('vault.search')}
          placeholder={t('vault.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <TabsContent value="credentials" className="pt-3">
          {creds.isPending ? (
            <Skeleton className="h-32" />
          ) : (creds.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('vault.noCredentials')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('vault.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.kind')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.username')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.secret')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('vault.devices')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.rotateDue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(creds.data ?? []).map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => open('credential', c.id)}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="px-3 py-2">{t(`vault.kinds.${c.kind}`)}</td>
                      <td className="px-3 py-2 font-mono">{c.username || '—'}</td>
                      <td className="px-3 py-2">
                        <SecretField
                          orgId={orgId}
                          target={{ credentialId: c.id }}
                          hasSecret={c.hasSecret}
                          canReveal={rights.canReveal}
                          label={c.name}
                        />
                      </td>
                      <td data-numeric className="px-3 py-2 text-right">
                        {c.deviceCount}
                      </td>
                      <td className="px-3 py-2">
                        {c.rotateDue ? <WarrantyText date={c.rotateDue} /> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="cloud" className="pt-3">
          {clouds.isPending ? (
            <Skeleton className="h-32" />
          ) : (clouds.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('vault.noCloud')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('vault.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.provider')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.username')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.secret')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.mfaHolder')}</th>
                    <th className="px-3 py-2 font-medium">{t('vault.expiresOn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(clouds.data ?? []).map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => open('account', a.id)}
                        >
                          {a.name}
                        </button>
                      </td>
                      <td className="px-3 py-2">{t(`vault.providers.${a.provider}`)}</td>
                      <td className="px-3 py-2">{a.username || '—'}</td>
                      <td className="px-3 py-2">
                        <SecretField
                          orgId={orgId}
                          target={{ accountId: a.id }}
                          hasSecret={a.hasSecret}
                          canReveal={rights.canReveal}
                          label={a.name}
                        />
                      </td>
                      <td className="px-3 py-2">{a.mfaHolder || '—'}</td>
                      <td className="px-3 py-2">
                        {a.expiresOn ? <WarrantyText date={a.expiresOn} /> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {adding === 'credential' && (
        <CredentialDialog orgId={orgId} onClose={() => setAdding(null)} />
      )}
      {adding === 'cloud' && <CloudDialog orgId={orgId} onClose={() => setAdding(null)} />}
      {openCredential && (
        <CredentialSheet orgId={orgId} id={openCredential} onClose={() => open('credential', '')} />
      )}
      {openAccount && (
        <CloudSheet orgId={orgId} id={openAccount} onClose={() => open('account', '')} />
      )}
    </div>
  )
}

function CredentialSheet({
  orgId,
  id,
  onClose,
}: {
  orgId: string
  id: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const detail = useCredential(orgId, id)
  const rights = useVaultRights(orgId)
  const { remove } = useCredentialMutations(orgId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const c = detail.data?.credential
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c?.name ?? '…'}</DialogTitle>
        </DialogHeader>
        {detail.isError && <p className="text-sm text-status-down">{detail.error.message}</p>}
        {c && (
          <div className="space-y-3">
            <KeyValueList
              columns={2}
              wrap
              items={[
                { label: t('vault.kind'), value: t(`vault.kinds.${c.kind}`) },
                {
                  label: t('vault.username'),
                  value: <span className="font-mono">{c.username || '—'}</span>,
                },
                {
                  label: c.kind === 'snmp' ? t('vault.community') : t('vault.secret'),
                  value: (
                    <SecretField
                      orgId={orgId}
                      target={{ credentialId: c.id }}
                      hasSecret={c.hasSecret}
                      canReveal={rights.canReveal}
                      label={c.name}
                    />
                  ),
                },
                {
                  label: t('vault.rotateDays'),
                  value: c.rotateDays ? t('vault.everyDays', { count: c.rotateDays }) : '—',
                },
                {
                  label: t('vault.lastRotatedOn'),
                  value: c.lastRotatedOn ? formatDate(c.lastRotatedOn) : '—',
                },
                {
                  label: t('vault.rotateDue'),
                  value: c.rotateDue ? <WarrantyText date={c.rotateDue} /> : '—',
                },
                { label: t('vendors.notes'), value: c.notes || '—' },
              ]}
            />
            {!rights.canReveal && (
              <p className="text-xs text-muted-foreground">{t('vault.noRevealRight')}</p>
            )}
            <section aria-label={t('vault.devices')}>
              <h3 className="mb-1 text-sm font-semibold">{t('vault.devices')}</h3>
              {detail.data!.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('vault.noDevices')}</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {detail.data!.devices.map((d) => (
                    <li key={d.deviceId}>
                      <Link
                        to={`/o/${orgId}/devices/${d.deviceId}`}
                        className="font-mono text-tech hover:underline"
                      >
                        {d.hostname}
                      </Link>{' '}
                      <span className="text-muted-foreground">
                        {d.siteCode}
                        {d.purpose && ` · ${t(`vault.kinds.${d.purpose as 'ssh'}`, d.purpose)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {rights.canManage && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> {t('common.edit')}
                </Button>
                <Button variant="outline" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden /> {t('common.delete')}
                </Button>
              </div>
            )}
          </div>
        )}
        {editing && detail.data && (
          <CredentialDialog orgId={orgId} detail={detail.data} onClose={() => setEditing(false)} />
        )}
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t('vault.deleteTitle', { name: c?.name ?? '' })}
          description={t('vault.deleteBody')}
          confirmLabel={t('common.delete')}
          onConfirm={() =>
            remove.mutate(id, { onSuccess: onClose, onError: (e) => toast.error(e.message) })
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function CloudSheet({ orgId, id, onClose }: { orgId: string; id: string; onClose: () => void }) {
  const { t } = useTranslation()
  const detail = useCloudAccount(orgId, id)
  const rights = useVaultRights(orgId)
  const { remove } = useCloudMutations(orgId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const a = detail.data?.account
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{a?.name ?? '…'}</DialogTitle>
        </DialogHeader>
        {detail.isError && <p className="text-sm text-status-down">{detail.error.message}</p>}
        {a && (
          <div className="space-y-3">
            <KeyValueList
              columns={2}
              wrap
              items={[
                { label: t('vault.provider'), value: t(`vault.providers.${a.provider}`) },
                {
                  label: t('vault.portalUrl'),
                  value: safeHref(a.portalUrl) ? (
                    <a
                      href={safeHref(a.portalUrl)!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      {a.portalUrl}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                { label: t('vault.username'), value: a.username || '—' },
                {
                  label: t('vault.secret'),
                  value: (
                    <SecretField
                      orgId={orgId}
                      target={{ accountId: a.id }}
                      hasSecret={a.hasSecret}
                      canReveal={rights.canReveal}
                      label={a.name}
                    />
                  ),
                },
                { label: t('vault.mfaHolder'), value: a.mfaHolder || '—' },
                { label: t('vault.plan'), value: a.plan || '—' },
                {
                  label: t('vault.expiresOn'),
                  value: a.expiresOn ? <WarrantyText date={a.expiresOn} /> : '—',
                },
                {
                  label: t('contracts.vendor'),
                  value: a.vendorId ? (
                    <Link to={`/o/${orgId}/vendors/${a.vendorId}`} className="hover:underline">
                      {a.vendorName}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: t('vendors.notes'), value: a.notes || '—' },
              ]}
            />
            <section aria-label={t('vault.managedDevices')}>
              <h3 className="mb-1 text-sm font-semibold">{t('vault.managedDevices')}</h3>
              {detail.data!.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('vault.noDevices')}</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {detail.data!.devices.map((d) => (
                    <li key={d.deviceId}>
                      <Link
                        to={`/o/${orgId}/devices/${d.deviceId}`}
                        className="font-mono text-tech hover:underline"
                      >
                        {d.hostname}
                      </Link>{' '}
                      <span className="text-muted-foreground">{d.siteCode}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {rights.canManage && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> {t('common.edit')}
                </Button>
                <Button variant="outline" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden /> {t('common.delete')}
                </Button>
              </div>
            )}
          </div>
        )}
        {editing && detail.data && (
          <CloudDialog orgId={orgId} detail={detail.data} onClose={() => setEditing(false)} />
        )}
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t('vault.deleteTitle', { name: a?.name ?? '' })}
          description={t('vault.deleteBody')}
          confirmLabel={t('common.delete')}
          onConfirm={() =>
            remove.mutate(id, { onSuccess: onClose, onError: (e) => toast.error(e.message) })
          }
        />
      </DialogContent>
    </Dialog>
  )
}
