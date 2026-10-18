import { Network, Pencil, Server, ShieldCheck, ShieldOff, Users } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { FormField } from '@/components/FormField'
import { KeyValueList } from '@/components/KeyValueList'
import { MfaCodeInput } from '@/components/MfaCodeInput'
import { OrgAvatar } from '@/components/OrgAvatar'
import { PageHeader } from '@/components/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { type AuthSession, type OrganizationView } from '../api/client'
import { useMfaDisable, useSession } from './auth'
import { NotFoundPage } from './NotFoundPage'
import { DashboardPanels } from '@/modules/dashboard/DashboardPanels'
import { SiteCodeChangesDialog } from '@/modules/sites/CategoryDialogs'
import { previewOrgCode, type SiteCodeChange } from '@/modules/sites/sites'
import { ConflictError, NotFoundError, useOrganization, useUpdateOrganization } from './orgs'
import { useHelpTopic } from '@/help/topic'

function Panel({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-card">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

/**
 * Owner/admin edit name, code and notes; a 409 means someone else saved first (optimistic lock). A new code
 * re-codes every site (ADR-032): the changes are listed for confirmation first.
 */
function EditOrganizationDialog({
  orgId,
  view,
  open,
  onClose,
}: {
  orgId: string
  view: OrganizationView
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateOrganization(orgId)
  const [name, setName] = useState(view.organization.name)
  const [code, setCode] = useState(view.organization.code)
  const [notes, setNotes] = useState(view.organization.notes)
  const [changes, setChanges] = useState<SiteCodeChange[] | null>(null)

  const submit = (confirmSiteCodes: boolean) =>
    update.mutate(
      { name, code, notes, version: view.organization.version, confirmSiteCodes },
      {
        onSuccess: () => {
          toast.success(t('members.saved'))
          onClose()
        },
        onSettled: () => setChanges(null),
      },
    )
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (code !== view.organization.code) {
      const list = await previewOrgCode(orgId, code).catch(() => null)
      if (list && list.length > 0) {
        setChanges(list)
        return
      }
    }
    submit(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t('home.edit')}</DialogTitle>
            </DialogHeader>
            <FormField label={t('home.name')} required>
              {(f) => (
                <Input
                  {...f}
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </FormField>
            <FormField label={t('home.code')} required hint={t('home.codeHint')}>
              {(f) => (
                <Input
                  {...f}
                  required
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="font-mono uppercase"
                />
              )}
            </FormField>
            <FormField label={t('home.notes')}>
              {(f) => (
                <Textarea
                  {...f}
                  rows={4}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </FormField>
            {update.isError && (
              <p role="alert" className="text-destructive">
                {update.error.message}
                {update.error instanceof ConflictError && ` ${t('home.conflict')}`}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {changes && (
        <SiteCodeChangesDialog
          changes={changes}
          pending={update.isPending}
          onConfirm={() => submit(true)}
          onCancel={() => setChanges(null)}
        />
      )}
    </>
  )
}

function OrganizationPanel({ orgId, view }: { orgId: string; view: OrganizationView }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const o = view.organization
  const canAdmin = view.membership.role === 'owner' || view.membership.role === 'admin'
  return (
    <Panel
      title={t('home.organization')}
      actions={
        canAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> {t('home.edit')}
          </Button>
        )
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <OrgAvatar id={o.id} name={o.name} />
        <h2 className="text-sm font-semibold">{o.name}</h2>
      </div>
      <KeyValueList
        columns={2}
        items={[
          {
            label: t('home.kind'),
            value: o.kind === 'customer' ? t('adminOrgs.customer') : t('adminOrgs.internal'),
          },
          { label: t('home.yourRole'), value: t(`roles.${view.membership.role}`) },
        ]}
      />
      <div className="mt-3 space-y-1">
        <p className="text-label text-muted-foreground">{t('home.notes')}</p>
        <p className="whitespace-pre-wrap">
          {o.notes || <span className="text-muted-foreground">{t('home.noNotes')}</span>}
        </p>
      </div>
      {editing && (
        <EditOrganizationDialog
          key={o.version}
          orgId={orgId}
          view={view}
          open
          onClose={() => setEditing(false)}
        />
      )}
    </Panel>
  )
}

/** MFA status with an enable link, or a disable form for users not required to use MFA. */
function AccountPanel({ session }: { session: AuthSession }) {
  const { t } = useTranslation()
  const disable = useMfaDisable()
  const [code, setCode] = useState('')
  const { enabled, required } = session.mfa
  const user = session.user

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    disable.mutate(code, { onSuccess: () => setCode('') })
  }

  return (
    <Panel title={t('home.account')}>
      <p className="mb-3">{t('home.greeting', { name: user.displayName || user.email })}</p>
      <KeyValueList
        columns={1}
        wrap
        items={[
          { label: 'Email', value: user.email },
          {
            label: t('home.mfaStatus'),
            value: enabled ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck aria-hidden className="size-4 text-status-up" />
                {required ? t('home.mfaRequired') : t('home.mfaEnabled')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ShieldOff aria-hidden className="size-4" /> {t('home.mfaDisabled')}
              </span>
            ),
          },
        ]}
      />
      {!enabled && (
        <Link
          to="/mfa/setup?next=/"
          className={buttonVariants({ variant: 'outline', className: 'mt-3' })}
        >
          {t('home.mfaEnable')}
        </Link>
      )}
      {enabled && !required && (
        <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
          <MfaCodeInput
            aria-label={t('home.mfaDisableCode')}
            placeholder="000000"
            required
            value={code}
            onChange={setCode}
            className="h-(--control-h) w-32 text-sm tracking-[0.2em]"
          />
          <Button type="submit" variant="outline" disabled={disable.isPending || code.length !== 6}>
            {t('home.mfaDisable')}
          </Button>
          {disable.isError && (
            <span role="alert" className="text-destructive">
              {disable.error.message}
            </span>
          )}
        </form>
      )}
    </Panel>
  )
}

function QuickLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:border-border-control hover:bg-muted"
    >
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      {label}
    </Link>
  )
}

/**
 * Organization landing page /o/:orgId: the dashboard (P1-24) first, then the organization and account panels.
 * Health moved to the system area (DESIGN.md §6).
 */
export function OrgHomePage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const session = useSession()
  const org = useOrganization(orgId)
  useBreadcrumbs([{ label: t('nav.dashboard') }])
  useHelpTopic('bat-dau-nhanh')

  if (org.isError) {
    if (org.error instanceof NotFoundError) return <NotFoundPage inShell />
    return (
      <p role="alert" className="p-4 text-destructive">
        {org.error.message}
      </p>
    )
  }

  const base = `/o/${orgId}`
  return (
    <div className="space-y-3 p-4">
      <PageHeader title={t('nav.dashboard')} description={org.data?.organization.name} />
      <div className="max-w-6xl">
        <DashboardPanels orgId={orgId} />
      </div>
      <div className="grid max-w-6xl grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {org.data && <OrganizationPanel orgId={orgId} view={org.data} />}
          <Panel title={t('home.quickLinks')}>
            <div className="grid grid-cols-3 gap-2">
              <QuickLink to={`${base}/devices`} icon={<Server />} label={t('nav.devices')} />
              <QuickLink to={`${base}/diagrams`} icon={<Network />} label={t('nav.diagrams')} />
              <QuickLink to={`${base}/members`} icon={<Users />} label={t('nav.members')} />
            </div>
          </Panel>
        </div>
        {session.data && <AccountPanel session={session.data} />}
      </div>
    </div>
  )
}
