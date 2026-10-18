import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSaveTarget, type BackupTarget, type BackupTargetKind } from './backups'

/** Kinds offered, grouped by who they suit (the user chose "options for every size of customer", ADR-053). */
const KINDS: { kind: BackupTargetKind; audience: 'personal' | 'office' | 'enterprise' }[] = [
  { kind: 'drive', audience: 'personal' },
  { kind: 'onedrive', audience: 'personal' },
  { kind: 'dropbox', audience: 'personal' },
  { kind: 'local', audience: 'office' },
  { kind: 'sftp', audience: 'office' },
  { kind: 's3', audience: 'enterprise' },
]

/** S3 providers: rclone name, label key, endpoint hint. "Other" covers Backblaze B2 and any S3 API. */
const PROVIDERS = ['AWS', 'Other', 'Wasabi', 'Cloudflare', 'Synology', 'Minio'] as const

type Settings = NonNullable<BackupTarget['settings']>

/**
 * Add / change a backup destination (P2-13). Secrets are write-only: on a change, an empty field keeps the stored one.
 * Each kind explains where its values come from (DESIGN.md §4a).
 */
export function BackupTargetDialog({
  target,
  onClose,
  onSaved,
}: {
  target: BackupTarget | null
  onClose: () => void
  onSaved: (t: BackupTarget) => void
}) {
  const { t } = useTranslation()
  const save = useSaveTarget()
  const [kind, setKind] = useState<BackupTargetKind>(target?.kind ?? 'local')
  const [name, setName] = useState(target?.name ?? '')
  const [enabled, setEnabled] = useState(target?.enabled ?? true)
  const [keep, setKeep] = useState(target?.keep ?? '7,4,12')
  const [st, setSt] = useState<Settings>(target?.settings ?? { provider: 'AWS' })
  const [secret, setSecret] = useState({ password: '', privateKey: '', secretKey: '', token: '' })
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt({ ...st, [k]: v })
  const stored = target?.secretSet === true
  const keepHint = stored ? t('backups.target.secretKept') : undefined

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const secrets = Object.fromEntries(Object.entries(secret).filter(([, v]) => v !== ''))
    save.mutate(
      {
        id: target?.id,
        body: {
          name,
          kind,
          enabled,
          keep,
          settings: { ...st, port: st.port ? Number(st.port) : undefined },
          ...secrets,
          ...(target ? { version: target.version } : {}),
        },
      },
      {
        onSuccess: (saved) => {
          toast.success(t('backups.target.saved'))
          onSaved(saved)
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const text = (
    k: keyof Settings,
    label: string,
    opts: { hint?: string; guide?: string; placeholder?: string } = {},
  ) => (
    <FormField label={label} hint={opts.hint} guide={opts.guide}>
      {(p) => (
        <Input
          {...p}
          value={(st[k] as string | undefined) ?? ''}
          placeholder={opts.placeholder}
          onChange={(e) => set(k, e.target.value as never)}
        />
      )}
    </FormField>
  )
  const secretField = (
    k: keyof typeof secret,
    label: string,
    opts: { multiline?: boolean; guide?: string } = {},
  ) => (
    <FormField label={label} hint={keepHint} guide={opts.guide}>
      {(p) =>
        opts.multiline ? (
          <Textarea
            {...p}
            rows={4}
            className="font-mono text-xs"
            value={secret[k]}
            placeholder={stored ? '••••••' : undefined}
            onChange={(e) => setSecret({ ...secret, [k]: e.target.value })}
          />
        ) : (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={secret[k]}
            placeholder={stored ? '••••••' : undefined}
            onChange={(e) => setSecret({ ...secret, [k]: e.target.value })}
          />
        )
      }
    </FormField>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target ? t('backups.target.edit') : t('backups.target.add')}</DialogTitle>
          <DialogDescription>{t('backups.target.intro')}</DialogDescription>
        </DialogHeader>
        <form id="backup-target" onSubmit={onSubmit} className="space-y-3">
          {!target && (
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 text-sm font-medium">{t('backups.target.kind')}</legend>
              {KINDS.map(({ kind: k, audience }) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md border p-2 text-left text-sm hover:border-primary',
                    kind === k ? 'border-primary ring-1 ring-primary' : 'border-border',
                  )}
                >
                  <span className="block font-medium">{t(`backups.kinds2.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`backups.audience.${audience}`)}
                  </span>
                </button>
              ))}
            </fieldset>
          )}
          <p className="rounded-md bg-muted p-2 text-sm text-muted-foreground">
            {t(`backups.target.guide.${kind}`)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('backups.target.name')}>
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  maxLength={100}
                  placeholder={t(`backups.kinds2.${kind}`)}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </FormField>
            <FormField label={t('backups.target.keep')} hint={t('backups.target.keepHint')}>
              {(p) => (
                <Input
                  {...p}
                  value={keep}
                  maxLength={20}
                  onChange={(e) => setKeep(e.target.value)}
                />
              )}
            </FormField>
            {kind === 'local' &&
              text('path', t('backups.target.folder'), {
                placeholder: '/mnt/nas/ntb',
                hint: t('backups.target.localHint'),
              })}
            {kind === 'sftp' && (
              <>
                {text('host', t('backups.target.host'), { placeholder: 'nas.congty.local' })}
                <FormField label={t('backups.target.port')}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={st.port ?? ''}
                      placeholder="22"
                      onChange={(e) =>
                        set(
                          'port',
                          (e.target.value === '' ? undefined : Number(e.target.value)) as never,
                        )
                      }
                    />
                  )}
                </FormField>
                {text('user', t('backups.target.user'))}
                {text('path', t('backups.target.folder'), { placeholder: 'backups/ntb' })}
                {secretField('password', t('backups.target.password'))}
                {secretField('privateKey', t('backups.target.privateKey'), {
                  multiline: true,
                  guide: t('backups.target.privateKeyGuide'),
                })}
              </>
            )}
            {kind === 's3' && (
              <>
                <FormField label={t('backups.target.provider')}>
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={st.provider ?? 'AWS'}
                      onChange={(e) => set('provider', e.target.value)}
                    >
                      {PROVIDERS.map((v) => (
                        <option key={v} value={v}>
                          {t(`backups.providers.${v}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                {text('endpoint', t('backups.target.endpoint'), {
                  hint:
                    st.provider === 'AWS'
                      ? t('backups.target.endpointAws')
                      : t(
                          `backups.endpointHints.${(st.provider ?? 'Other') as Exclude<(typeof PROVIDERS)[number], 'AWS'>}`,
                        ),
                })}
                {text('region', t('backups.target.region'), { placeholder: 'ap-southeast-1' })}
                {text('bucket', t('backups.target.bucket'), {
                  guide: t('backups.target.objectLockGuide'),
                })}
                {text('path', t('backups.target.prefix'), { placeholder: 'ntb' })}
                {text('accessKeyId', t('backups.target.accessKey'))}
                {secretField('secretKey', t('backups.target.secretKey'))}
              </>
            )}
            {(kind === 'drive' || kind === 'onedrive' || kind === 'dropbox') &&
              text('path', t('backups.target.folder'), { placeholder: 'NTB-backups' })}
          </div>
          {kind === 'sftp' && (
            <FormField label={t('backups.target.hostKey')} guide={t('backups.target.hostKeyGuide')}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  className="font-mono text-xs"
                  value={st.hostKey ?? ''}
                  placeholder="nas.congty.local ssh-ed25519 AAAA…"
                  onChange={(e) => set('hostKey', e.target.value)}
                />
              )}
            </FormField>
          )}
          {(kind === 'drive' || kind === 'onedrive' || kind === 'dropbox') &&
            secretField('token', t('backups.target.token'), {
              multiline: true,
              guide: t('backups.target.tokenGuide', { backend: kind }),
            })}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            {t('backups.target.enabled')}
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="backup-target" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
