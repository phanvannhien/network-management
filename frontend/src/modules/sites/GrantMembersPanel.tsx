import { Trash2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { OneTimeLinkDialog } from '@/components/OneTimeLinkDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { accountLink } from '@/modules/admin/members'
import {
  PARTNER_GRANT_ROLES,
  UNIT_GRANT_ROLES,
  useGrantMutations,
  useGrants,
  type GrantMember,
  type GrantScope,
} from './grants'

/**
 * Users granted on a partner or unit (ADR-031), for admins of that scope: invite by email (new emails get a
 * one-time link), change the role, revoke. A partner grant also covers every unit of the partner.
 */
export function GrantMembersPanel({
  orgId,
  scope,
  code,
}: {
  orgId: string
  scope: GrantScope
  code: string
}) {
  const { t } = useTranslation()
  const grants = useGrants(orgId, scope)
  const { add, update, remove } = useGrantMutations(orgId, scope)
  const roles: string[] = scope.kind === 'partner' ? PARTNER_GRANT_ROLES : UNIT_GRANT_ROLES
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [link, setLink] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<GrantMember | null>(null)

  const onInvite = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (r) => {
          setEmail('')
          if (r.inviteToken) setLink(r.inviteToken)
          else toast.success(t('grants.added', { email: r.member.email }))
        },
      },
    )
  }

  return (
    <section
      aria-label={t('grants.title', { code })}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{t('grants.title', { code })}</h2>
        <p className="text-muted-foreground">
          {scope.kind === 'partner' ? t('grants.partnerHint') : t('grants.unitHint')}
        </p>
      </div>
      <form onSubmit={onInvite} className="grid grid-cols-[1fr_180px_auto] items-end gap-2">
        <FormField label={t('grants.email')}>
          {(p) => (
            <Input
              {...p}
              type="email"
              required
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('grants.role')}>
          {(p) => (
            <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`grants.roles.${r as 'viewer'}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <Button type="submit" disabled={add.isPending}>
          <UserPlus aria-hidden /> {t('grants.invite')}
        </Button>
      </form>
      {add.isError && (
        <p role="alert" className="text-destructive">
          {add.error.message}
        </p>
      )}
      {grants.isPending ? (
        <Skeleton className="h-16" />
      ) : grants.isError ? (
        <p role="alert" className="text-destructive">
          {grants.error.message}
        </p>
      ) : grants.data.length === 0 ? (
        <p className="text-muted-foreground">{t('grants.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {grants.data.map((g) => (
            <li key={g.userId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{g.displayName || g.email}</div>
                <div className="truncate text-muted-foreground">
                  {g.email}{' '}
                  {g.pendingInvite && <StatusBadge status="planned" label={t('grants.pending')} />}
                </div>
              </div>
              <div className="w-44">
                <NativeSelect
                  aria-label={t('grants.roleOf', { email: g.email })}
                  value={g.role}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate(
                      { member: g, role: e.target.value },
                      {
                        onSuccess: () => toast.success(t('grants.saved')),
                        onError: (err) => toast.error(err.message),
                      },
                    )
                  }
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {t(`grants.roles.${r as 'viewer'}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('grants.revokeOf', { email: g.email })}
                onClick={() => setRevoking(g)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('grants.revokeTitle', { email: revoking?.email ?? '' })}
        description={t('grants.revokeBody')}
        confirmLabel={t('grants.revoke')}
        pending={remove.isPending}
        onConfirm={() =>
          revoking &&
          remove.mutate(revoking, {
            onSuccess: () => {
              setRevoking(null)
              toast.success(t('grants.revoked'))
            },
            onError: (err) => {
              setRevoking(null)
              toast.error(err.message)
            },
          })
        }
      />
      <OneTimeLinkDialog
        link={link ? accountLink(link) : null}
        title={t('members.linkTitle')}
        description={t('members.linkBody')}
        onClose={() => setLink(null)}
      />
    </section>
  )
}
