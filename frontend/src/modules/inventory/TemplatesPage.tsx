import { LayoutTemplate, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useBreadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrgAccess } from '@/modules/sites/access'
import { SystemTemplates } from './SystemTemplates'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DEVICE_TYPE_GROUPS,
  expandPorts,
  MEDIA,
  useCatalog,
  useTemplateMutations,
  useTemplates,
  type DeviceTemplate,
  type DeviceType,
  type InterfaceMedia,
  type PortGroup,
} from './devices'
import { useHelpTopic } from '@/help/topic'

/** Common models to start from (the full model library is Phase 2, SRS §4.3). */
const PRESETS: {
  name: string
  type: DeviceType
  vendor: string
  model: string
  partNumber: string
  uHeight: number
  ports: PortGroup[]
}[] = [
  {
    name: 'Cisco C9200-24P',
    type: 'poe_switch',
    vendor: 'Cisco',
    model: 'C9200-24P',
    partNumber: 'C9200-24P-E',
    uHeight: 1,
    ports: [
      { pattern: 'Gi{m}/0/{n}', start: 1, count: 24, media: 'RJ45', speed: '1G', poe: true },
      { pattern: 'Gi{m}/1/{n}', start: 1, count: 4, media: 'SFP', speed: '1G' },
    ],
  },
  {
    name: 'Cisco C9300-48UXM',
    type: 'l3_switch',
    vendor: 'Cisco',
    model: 'C9300-48UXM',
    partNumber: 'C9300-48UXM-E',
    uHeight: 1,
    ports: [
      { pattern: 'Gi{m}/0/{n}', start: 1, count: 36, media: 'RJ45', speed: '1G', poe: true },
      { pattern: 'Te{m}/0/{n}', start: 37, count: 12, media: 'RJ45', speed: '10G', poe: true },
    ],
  },
  {
    name: 'Fortinet FortiGate 100F',
    type: 'firewall',
    vendor: 'Fortinet',
    model: 'FortiGate 100F',
    partNumber: 'FG-100F',
    uHeight: 1,
    ports: [
      { pattern: 'mgmt', start: 1, count: 1, media: 'RJ45', speed: '1G' },
      { pattern: 'wan{n}', start: 1, count: 2, media: 'RJ45', speed: '1G' },
      { pattern: 'port{n}', start: 1, count: 16, media: 'RJ45', speed: '1G' },
      { pattern: 'x{n}', start: 1, count: 2, media: 'SFP+', speed: '10G' },
    ],
  },
  {
    name: 'Aruba CX 6100 24G',
    type: 'poe_switch',
    vendor: 'Aruba',
    model: 'CX 6100 24G',
    partNumber: 'JL677A',
    uHeight: 1,
    ports: [
      { pattern: '{m}/1/{n}', start: 1, count: 24, media: 'RJ45', speed: '1G', poe: true },
      { pattern: '{m}/1/{n}', start: 25, count: 4, media: 'SFP+', speed: '10G' },
    ],
  },
  {
    name: 'MikroTik CCR2004-16G-2S+',
    type: 'router',
    vendor: 'MikroTik',
    model: 'CCR2004-16G-2S+',
    partNumber: 'CCR2004-16G-2S+',
    uHeight: 1,
    ports: [
      { pattern: 'ether{n}', start: 1, count: 16, media: 'RJ45', speed: '1G' },
      { pattern: 'sfp-sfpplus{n}', start: 1, count: 2, media: 'SFP+', speed: '10G' },
    ],
  },
]

function TemplateDialog({
  orgId,
  template,
  onClose,
}: {
  orgId: string
  template?: DeviceTemplate
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { save } = useTemplateMutations(orgId)
  const [f, setF] = useState({
    name: template?.name ?? '',
    type: (template?.type ?? 'l2_switch') as DeviceType,
    vendor: template?.vendor ?? '',
    model: template?.model ?? '',
    partNumber: template?.partNumber ?? '',
    uHeight: String(template?.uHeight ?? 1),
  })
  const [groups, setGroups] = useState<PortGroup[]>(
    template?.ports ?? [{ pattern: 'Gi1/0/{n}', start: 1, count: 24, media: 'RJ45', speed: '1G' }],
  )
  const ports = expandPorts(groups)
  const setGroup = (i: number, g: Partial<PortGroup>) =>
    setGroups(groups.map((x, j) => (j === i ? { ...x, ...g } : x)))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        template,
        body: {
          name: f.name.trim(),
          type: f.type,
          vendor: f.vendor,
          model: f.model,
          partNumber: f.partNumber,
          uHeight: Number(f.uHeight) || 1,
          ports: groups,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('templates.saved'))
          onClose()
        },
      },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label={template ? t('templates.edit') : t('templates.add')}
        >
          <DialogHeader>
            <DialogTitle>{template ? t('templates.edit') : t('templates.add')}</DialogTitle>
          </DialogHeader>
          {!template && (
            <NativeSelect
              aria-label={t('templates.preset')}
              value=""
              onChange={(e) => {
                const p = PRESETS.find((x) => x.name === e.target.value)
                if (!p) return
                setF({
                  name: p.name,
                  type: p.type,
                  vendor: p.vendor,
                  model: p.model,
                  partNumber: p.partNumber,
                  uHeight: String(p.uHeight),
                })
                setGroups(p.ports)
              }}
            >
              <option value="">{t('templates.preset')}</option>
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t('templates.name')} help="template" required className="col-span-2">
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={100}
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              )}
            </FormField>
            <FormField label={t('devices.type')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={f.type}
                  onChange={(e) => setF({ ...f, type: e.target.value as DeviceType })}
                >
                  {DEVICE_TYPE_GROUPS.map((g) => (
                    <optgroup key={g.group} label={t(`devices.typeGroups.${g.group}`)}>
                      {g.types.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`devices.types.${ty}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {(
              [
                ['vendor', 'vendor'],
                ['model', 'model'],
                ['partNumber', 'partNumber'],
              ] as const
            ).map(([k, label]) => (
              <FormField
                key={k}
                label={t(`devices.${label}`)}
                help={k === 'partNumber' ? 'part-number' : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={100}
                    value={f[k]}
                    onChange={(e) => setF({ ...f, [k]: e.target.value })}
                  />
                )}
              </FormField>
            ))}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-form font-medium">{t('templates.ports')}</legend>
            <p className="text-label text-muted-foreground">{t('templates.portsHint')}</p>
            {groups.map((g, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_80px_80px_110px_80px_auto_auto] items-end gap-2"
              >
                <FormField label={t('templates.pattern')} help="interface">
                  {(p) => (
                    <Input
                      {...p}
                      required
                      maxLength={60}
                      value={g.pattern}
                      onChange={(e) => setGroup(i, { pattern: e.target.value })}
                      className="font-mono"
                    />
                  )}
                </FormField>
                <FormField label={t('templates.start')}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      value={g.start}
                      onChange={(e) => setGroup(i, { start: Number(e.target.value) })}
                    />
                  )}
                </FormField>
                <FormField label={t('templates.count')}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      max={512}
                      value={g.count}
                      onChange={(e) => setGroup(i, { count: Number(e.target.value) })}
                    />
                  )}
                </FormField>
                <FormField label={t('devices.media')} help="media">
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={g.media ?? ''}
                      onChange={(e) => setGroup(i, { media: e.target.value as InterfaceMedia })}
                    >
                      {MEDIA.map((m) => (
                        <option key={m} value={m}>
                          {m || '—'}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField label={t('devices.speed')}>
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={20}
                      value={g.speed ?? ''}
                      onChange={(e) => setGroup(i, { speed: e.target.value })}
                    />
                  )}
                </FormField>
                <label className="flex h-9 items-center gap-1.5 text-form">
                  <Checkbox
                    checked={g.poe ?? false}
                    onCheckedChange={(on) => setGroup(i, { poe: on === true })}
                  />
                  PoE
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('templates.removeGroup', { n: i + 1 })}
                  onClick={() => setGroups(groups.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setGroups([
                  ...groups,
                  { pattern: '', start: 1, count: 1, media: 'RJ45', speed: '' },
                ])
              }
            >
              <Plus aria-hidden /> {t('templates.addGroup')}
            </Button>
            <p className="text-muted-foreground" aria-live="polite">
              {ports.length
                ? t('templates.preview', {
                    count: ports.length,
                    first: ports[0],
                    last: ports[ports.length - 1],
                  })
                : t('templates.noPorts')}
            </p>
          </fieldset>
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Device templates of the organization (P1-09, SRS §4.3). */
export function TemplatesPage() {
  const { t } = useTranslation()
  const { orgId = '' } = useParams()
  const templates = useTemplates(orgId)
  const { remove } = useTemplateMutations(orgId)
  const canEdit = useOrgAccess(orgId).orgEdit
  const [editing, setEditing] = useState<DeviceTemplate | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DeviceTemplate | null>(null)
  const [tab, setTab] = useState<'own' | 'system'>('system')
  const catalogCount = useCatalog(orgId).data?.length ?? 0
  useBreadcrumbs([{ label: t('templates.title') }])
  useHelpTopic('thiet-bi#cong-va-ip')
  return (
    <div className="max-w-5xl space-y-3 p-4">
      <PageHeader
        title={t('templates.title')}
        actions={
          canEdit && (
            <Button
              onClick={() => {
                setTab('own')
                setEditing('new')
              }}
            >
              <Plus aria-hidden /> {t('templates.add')}
            </Button>
          )
        }
      />
      <p className="text-muted-foreground">{t('templates.subtitle')}</p>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'own' | 'system')}>
        <TabsList>
          <TabsTrigger value="system">
            {t('templates.system')} ({catalogCount})
          </TabsTrigger>
          <TabsTrigger value="own">
            {t('templates.own')} ({templates.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system" className="pt-2">
          <SystemTemplates
            orgId={orgId}
            canEdit={canEdit}
            onCopied={(tpl) => {
              setTab('own')
              setEditing(tpl)
            }}
          />
        </TabsContent>
        <TabsContent value="own" className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground">{t('templates.ownGuide')}</p>
          {templates.isPending ? (
            <Skeleton className="h-24" />
          ) : templates.isError ? (
            <p role="alert" className="text-destructive">
              {templates.error.message}
            </p>
          ) : templates.data.length === 0 ? (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState icon={<LayoutTemplate />} title={t('templates.empty')} />
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {templates.data.map((tp) => (
                <li key={tp.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{tp.name}</div>
                    <div className="text-muted-foreground">
                      {t(`devices.types.${tp.type}`)}
                      {tp.vendor && ` · ${tp.vendor}`}
                      {tp.partNumber && ` · ${tp.partNumber}`} ·{' '}
                      {t('templates.portCount', { count: tp.portCount })}
                    </div>
                  </div>
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t('templates.edit')} ${tp.name}`}
                        onClick={() => setEditing(tp)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t('templates.delete')} ${tp.name}`}
                        onClick={() => setDeleting(tp)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      {editing && (
        <TemplateDialog
          orgId={orgId}
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('templates.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('templates.deleteBody')}
        confirmLabel={t('templates.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSettled: () => setDeleting(null),
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
