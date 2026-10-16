import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { atLeast, useOrgAccess } from '@/modules/sites/access'
import { useSites } from '@/modules/sites/sites'
import {
  RANGE_KINDS,
  VLAN_COLORS,
  describeSubnet,
  useIpamMutations,
  useVlans,
  type IpRange,
  type IpRangeKind,
  type Subnet,
  type SubnetDetail,
  type Vlan,
} from './ipam'

function FormDialog({
  title,
  wide,
  error,
  pending,
  onSubmit,
  onClose,
  children,
}: {
  title: string
  wide?: boolean
  error?: string
  pending: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn('max-h-[90vh] overflow-y-auto', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
      >
        <form
          aria-label={title}
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Sites the caller may put IPAM objects in, plus "whole organization" for organization-wide roles. */
function SiteSelect({
  orgId,
  value,
  onChange,
  current,
  ...p
}: {
  orgId: string
  value: string
  onChange: (siteId: string) => void
  /** The object's current site stays listed even when the caller only views it. */
  current?: string | null
  id: string
  'aria-describedby'?: string
}) {
  const { t } = useTranslation()
  const sites = useSites(orgId)
  const access = useOrgAccess(orgId)
  const options = (sites.data ?? []).filter((s) => atLeast(s.access, 'edit') || s.id === current)
  return (
    <NativeSelect
      {...p}
      // Grant-only members must pick a site: organization-wide objects need an org role.
      required={!access.orgEdit && current !== null}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {(access.orgEdit || current === null) && <option value="">{t('ipam.orgWide')}</option>}
      {!access.orgEdit && value === '' && current !== null && (
        <option value="" disabled>
          {t('ipam.site')}…
        </option>
      )}
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name}
        </option>
      ))}
    </NativeSelect>
  )
}

export function VlanDialog({
  orgId,
  vlan,
  defaultSiteId,
  onClose,
}: {
  orgId: string
  vlan?: Vlan
  defaultSiteId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { saveVlan } = useIpamMutations(orgId)
  const [f, setF] = useState({
    vid: vlan ? String(vlan.vid) : '',
    name: vlan?.name ?? '',
    color: vlan?.color ?? VLAN_COLORS[1],
    description: vlan?.description ?? '',
    siteId: vlan ? (vlan.siteId ?? '') : (defaultSiteId ?? ''),
  })
  const title = vlan ? t('ipam.editVlan') : t('ipam.addVlan')
  return (
    <FormDialog
      title={title}
      pending={saveVlan.isPending}
      error={saveVlan.error?.message}
      onClose={onClose}
      onSubmit={() =>
        saveVlan.mutate(
          {
            vlan,
            body: {
              vid: Number(f.vid),
              name: f.name.trim(),
              color: f.color,
              description: f.description,
              siteId: f.siteId || null,
            },
          },
          {
            onSuccess: () => {
              toast.success(t('ipam.saved'))
              onClose()
            },
          },
        )
      }
    >
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <FormField label={t('ipam.vid')} required help="vlan" guide={t('guides.vlanId')}>
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              type="number"
              min={1}
              max={4094}
              value={f.vid}
              onChange={(e) => setF({ ...f, vid: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label={t('ipam.vlanName')} required>
          {(p) => (
            <Input
              {...p}
              required
              maxLength={100}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </FormField>
      </div>
      <FormField label={t('ipam.site')} guide={t('guides.vlanSite')} help="site">
        {(p) => (
          <SiteSelect
            {...p}
            orgId={orgId}
            current={vlan?.siteId}
            value={f.siteId}
            onChange={(siteId) => setF({ ...f, siteId })}
          />
        )}
      </FormField>
      <fieldset className="space-y-1 text-form">
        <legend className="font-medium">{t('ipam.color')}</legend>
        <div className="flex flex-wrap items-center gap-2">
          {VLAN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={t('ipam.colorOf', { color: c })}
              aria-pressed={f.color === c}
              onClick={() => setF({ ...f, color: c })}
              className={cn(
                'size-6 rounded-sm border border-border',
                f.color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            aria-label={t('ipam.color')}
            value={f.color}
            onChange={(e) => setF({ ...f, color: e.target.value.toLowerCase() })}
            className="h-6 w-10 cursor-pointer rounded-sm border border-border bg-transparent"
          />
        </div>
        <p className="text-muted-foreground">{t('guides.vlanColor')}</p>
      </fieldset>
      <FormField label={t('ipam.description')}>
        {(p) => (
          <Input
            {...p}
            maxLength={500}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        )}
      </FormField>
    </FormDialog>
  )
}

export function SubnetDialog({
  orgId,
  subnet,
  defaultSiteId,
  onClose,
  onSaved,
}: {
  orgId: string
  subnet?: Subnet
  defaultSiteId?: string
  onClose: () => void
  onSaved?: (s: SubnetDetail) => void
}) {
  const { t } = useTranslation()
  const { saveSubnet } = useIpamMutations(orgId)
  const vlans = useVlans(orgId)
  const [f, setF] = useState({
    cidr: subnet?.cidr ?? '',
    gateway: subnet?.gateway ?? '',
    vrf: subnet?.vrf ?? '',
    description: subnet?.description ?? '',
    siteId: subnet ? (subnet.siteId ?? '') : (defaultSiteId ?? ''),
    vlanId: subnet?.vlanId ?? '',
  })
  const preview = describeSubnet(f.cidr)
  // The subnet's own site's VLANs and the organization-wide ones (the server checks the same).
  const vlanOptions = (vlans.data ?? []).filter((v) => v.siteId === null || v.siteId === f.siteId)
  const title = subnet ? t('ipam.editSubnet') : t('ipam.addSubnet')
  return (
    <FormDialog
      title={title}
      wide
      pending={saveSubnet.isPending}
      error={saveSubnet.error?.message}
      onClose={onClose}
      onSubmit={() =>
        saveSubnet.mutate(
          {
            subnet,
            body: {
              cidr: f.cidr.trim(),
              gateway: f.gateway.trim() || null,
              vrf: f.vrf.trim(),
              description: f.description,
              siteId: f.siteId || null,
              vlanId: f.vlanId || null,
            },
          },
          {
            onSuccess: (saved) => {
              toast.success(t('ipam.saved'))
              onSaved?.(saved)
              onClose()
            },
          },
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t('ipam.cidr')}
          required
          help="cidr"
          guide={t('guides.subnetCidr')}
          className="col-span-2"
          hint={
            preview &&
            (preview.single ? (
              <span className="block text-status-warning">{t('ipam.previewSingle')}</span>
            ) : (
              <span data-numeric className="block font-medium text-foreground">
                {t('ipam.preview', preview)}
              </span>
            ))
          }
        >
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              placeholder="10.72.114.0/24"
              value={f.cidr}
              onChange={(e) => setF({ ...f, cidr: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label={t('ipam.gateway')} help="gateway" guide={t('guides.subnetGateway')}>
          {(p) => (
            <Input
              {...p}
              placeholder={preview && !preview.single ? preview.first : '10.72.114.1'}
              value={f.gateway}
              onChange={(e) => setF({ ...f, gateway: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label={t('ipam.vrf')} help="vrf" guide={t('hints.vrf')}>
          {(p) => (
            <Input
              {...p}
              maxLength={64}
              value={f.vrf}
              onChange={(e) => setF({ ...f, vrf: e.target.value })}
            />
          )}
        </FormField>
        <FormField label={t('ipam.site')} help="site" guide={t('guides.subnetSite')}>
          {(p) => (
            <SiteSelect
              {...p}
              orgId={orgId}
              current={subnet?.siteId}
              value={f.siteId}
              onChange={(siteId) => {
                const keep = vlanOptions.some(
                  (v) => v.id === f.vlanId && (v.siteId === null || v.siteId === siteId),
                )
                setF({ ...f, siteId, vlanId: keep ? f.vlanId : '' })
              }}
            />
          )}
        </FormField>
        <FormField label={t('ipam.vlan')} help="vlan" guide={t('hints.subnetVlan')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={f.vlanId}
              onChange={(e) => setF({ ...f, vlanId: e.target.value })}
            >
              <option value="">{t('ipam.noVlan')}</option>
              {vlanOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vid} — {v.name}
                  {v.siteId === null ? ` (${t('ipam.orgWide')})` : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField label={t('ipam.description')}>
        {(p) => (
          <Input
            {...p}
            maxLength={500}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        )}
      </FormField>
    </FormDialog>
  )
}

export function RangeDialog({
  orgId,
  subnet,
  range,
  onClose,
}: {
  orgId: string
  subnet: SubnetDetail
  range?: IpRange
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { saveRange } = useIpamMutations(orgId)
  const preview = describeSubnet(subnet.cidr)
  const [f, setF] = useState({
    startIp: range?.startIp ?? '',
    endIp: range?.endIp ?? '',
    kind: (range?.kind ?? 'dhcp') as IpRangeKind,
    purpose: range?.purpose ?? '',
  })
  const title = range ? t('ipam.rangeEdit') : t('ipam.rangeAdd')
  return (
    <FormDialog
      title={title}
      pending={saveRange.isPending}
      error={saveRange.error?.message}
      onClose={onClose}
      onSubmit={() =>
        saveRange.mutate(
          {
            subnetId: subnet.id,
            range,
            body: {
              startIp: f.startIp.trim(),
              endIp: f.endIp.trim(),
              kind: f.kind,
              purpose: f.purpose,
            },
          },
          {
            onSuccess: () => {
              toast.success(t('ipam.saved'))
              onClose()
            },
          },
        )
      }
    >
      {preview && !preview.single && (
        <p data-numeric className="text-muted-foreground">
          {t('ipam.preview', preview)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('ipam.startIp')} required>
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              placeholder={preview?.first}
              value={f.startIp}
              onChange={(e) => setF({ ...f, startIp: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField label={t('ipam.endIp')} required>
          {(p) => (
            <Input
              {...p}
              required
              placeholder={preview?.last}
              value={f.endIp}
              onChange={(e) => setF({ ...f, endIp: e.target.value })}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField
          label={t('ipam.kind')}
          help="ip-range"
          hint={t(`hints.rangeKinds.${f.kind}`)}
          className="col-span-2"
        >
          {(p) => (
            <NativeSelect
              {...p}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as IpRangeKind })}
            >
              {RANGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`ipam.rangeKinds.${k}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField label={t('ipam.purpose')} guide={t('guides.rangePurpose')}>
        {(p) => (
          <Input
            {...p}
            maxLength={200}
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          />
        )}
      </FormField>
    </FormDialog>
  )
}
