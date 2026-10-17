import { useQueryClient } from '@tanstack/react-query'
import ipaddr from 'ipaddr.js'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useDeferredValue, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { components } from '@/api/client'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useInterfaceMutations, useIpMutations } from '@/modules/inventory/devices'
import { SubnetDialog, VlanDialog } from '@/modules/ipam/IpamDialogs'
import { fetchNextFree, useIpLookup, useSubnets, useVlans } from '@/modules/ipam/ipam'
import { fetchDevice } from '../doc/api'
import { useDocStoreApi } from './context'
import { addressProblem, inSubnet, interfaceInput } from './portIpamRules'

// IPAM on a port, from the diagram panel (P1-18, ADR-034): mode / VLANs of the port and its IPs are written to the
// shared IPAM right away (not undone by Ctrl+Z — each write offers "Undo" in its notice). Warnings, not blocks: a VLAN
// unknown to IPAM, an address already used elsewhere in the VRF, the network / broadcast address, outside the subnet.

type Interface = components['schemas']['Interface']
type InterfaceInput = components['schemas']['InterfaceInput']
type IpAddress = components['schemas']['IpAddress']
type Device = components['schemas']['Device']

const MODES = ['', 'access', 'trunk', 'routed', 'hybrid'] as const

const portFields = (i: Interface) => ({
  mode: i.mode,
  accessVlan: i.accessVlan ? String(i.accessVlan) : '',
  allowedVlans: i.allowedVlans,
  nativeVlan: i.nativeVlan ? String(i.nativeVlan) : '',
})

/** A non-blocking warning: announced politely, not as an error. */
function Warning({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="block text-status-warning">
      {children}
    </span>
  )
}

export function PortIpam({
  orgId,
  device,
  iface,
  ips,
}: {
  orgId: string
  device: Device
  iface: Interface
  ips: IpAddress[]
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const store = useDocStoreApi()
  const { save: saveIface } = useInterfaceMutations(orgId, device.id)
  const { save: saveIp, remove: removeIp } = useIpMutations(orgId, device.id)
  const vlans = useVlans(orgId, device.siteId)
  const subnets = useSubnets(orgId, '', '')
  const [port, setPort] = useState(() => portFields(iface))
  const [portFor, setPortFor] = useState(iface.version)
  // A saved (or undone) port shows the server's values again; what is typed for the IP stays.
  if (portFor !== iface.version) {
    setPortFor(iface.version)
    setPort(portFields(iface))
  }
  const [subnetId, setSubnetId] = useState('')
  const [address, setAddress] = useState('')
  const [role, setRole] = useState<'primary' | 'secondary' | null>(null)
  const effectiveRole = role ?? (ips.some((x) => x.role === 'primary') ? 'secondary' : 'primary')
  const [creating, setCreating] = useState<'vlan' | 'subnet' | null>(null)

  const refreshIpam = () => qc.invalidateQueries({ queryKey: ['orgs', orgId, 'ipam'] })
  /**
   * After a write of ours the device version went up by one: a pending device edit of this diagram follows it (so the
   * diagram save does not conflict). Any other jump means someone else changed the device — the conflict is kept.
   */
  const afterOwnWrite = async () => {
    void refreshIpam()
    try {
      const before = store.getState().doc?.deviceEdits[device.id]?.version
      const fresh = await fetchDevice(orgId, device.id)
      const own = before !== undefined && fresh.version === before + 1
      store
        .getState()
        .syncDevice(device.id, { mgmtIp: fresh.mgmtIp, ...(own ? { version: fresh.version } : {}) })
    } catch {
      // the node shows the old IP until the next load
    }
  }
  const failed = (e: Error) => toast.error(e.message)
  const physical = iface.kind === 'physical' || iface.kind === 'subinterface'
  const vlanNumbers = vlans.data ? new Set(vlans.data.map((v) => v.vid)) : null
  const portDirty = JSON.stringify(port) !== JSON.stringify(portFields(iface))

  const savePort = () => {
    const before = interfaceInput(iface)
    const num = (v: string) => (v.trim() === '' ? null : Number(v))
    // Only the fields of the chosen mode are kept (access: one VLAN; trunk / hybrid: allowed + native; routed: none).
    const body: InterfaceInput = {
      ...before,
      mode: port.mode,
      accessVlan: port.mode === 'access' || port.mode === 'hybrid' ? num(port.accessVlan) : null,
      allowedVlans: port.mode === 'trunk' || port.mode === 'hybrid' ? port.allowedVlans.trim() : '',
      nativeVlan: port.mode === 'trunk' || port.mode === 'hybrid' ? num(port.nativeVlan) : null,
    }
    saveIface.mutate(
      { iface, body },
      {
        onSuccess: (saved) => {
          void afterOwnWrite()
          toast.success(t('portIpam.portSaved', { name: iface.name }), {
            action: {
              label: t('portIpam.undo'),
              onClick: () =>
                saveIface.mutate(
                  { iface: saved, body: before },
                  { onSuccess: () => void afterOwnWrite(), onError: failed },
                ),
            },
          })
        },
        onError: failed,
      },
    )
  }

  // Warnings for the address being typed.
  const typed = useDeferredValue(address.trim())
  const host = typed.split('/')[0] ?? ''
  const lookup = useIpLookup(orgId, host && ipaddr.isValid(host) ? host : '')
  const subnet = subnets.data?.find((s) => s.id === subnetId)
  const vrf = subnet?.vrf ?? ''
  const others = (lookup.data?.assignments ?? []).filter(
    (a) =>
      a.vrf === vrf &&
      a.deviceId !== device.id &&
      !(device.clusterId && a.clusterId === device.clusterId),
  )
  const problem = typed.includes('/') ? addressProblem(typed) : ''
  const outside = Boolean(subnet && host && ipaddr.isValid(host) && !inSubnet(host, subnet.cidr))
  const noSubnet = !subnet && Boolean(lookup.data && lookup.data.subnets.length === 0)
  const warning =
    others.length > 0
      ? t('portIpam.inUse', {
          who: others.map((a) => `${a.hostname} ${a.interfaceName}`).join(', '),
        })
      : problem
        ? t(`portIpam.problems.${problem}`)
        : outside
          ? t('portIpam.outside', { cidr: subnet!.cidr })
          : noSubnet
            ? t('portIpam.noSubnetFor')
            : ''

  const nextFree = async () => {
    if (!subnetId) return
    try {
      const a = await fetchNextFree(orgId, subnetId)
      if (a) setAddress(a)
      else toast.info(t('portIpam.full'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  const addIp = () => {
    saveIp.mutate(
      // The VRF follows the chosen subnet (a customer VRF keeps its own address space).
      { body: { interfaceId: iface.id, address: address.trim(), role: effectiveRole, vrf } },
      {
        onSuccess: (saved) => {
          void afterOwnWrite()
          setAddress('')
          setRole(null)
          toast.success(t('portIpam.ipAdded', { ip: saved.address, name: iface.name }), {
            action: {
              label: t('portIpam.undo'),
              onClick: () =>
                removeIp.mutate(saved.id, {
                  onSuccess: () => void afterOwnWrite(),
                  onError: failed,
                }),
            },
          })
        },
        onError: failed,
      },
    )
  }
  const dropIp = (ip: IpAddress) => {
    removeIp.mutate(ip.id, {
      onSuccess: () => {
        void afterOwnWrite()
        toast.success(t('portIpam.ipRemoved', { ip: ip.address }), {
          action: {
            label: t('portIpam.undo'),
            onClick: () =>
              saveIp.mutate(
                {
                  body: {
                    interfaceId: ip.interfaceId,
                    address: ip.address,
                    vrf: ip.vrf,
                    role: ip.role,
                    description: ip.description,
                  },
                },
                { onSuccess: () => void afterOwnWrite(), onError: failed },
              ),
          },
        })
      },
      onError: failed,
    })
  }
  // Picking a subnet proposes its next free IP when the field is empty.
  useEffect(() => {
    if (subnetId && address === '') void nextFree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subnetId])

  return (
    <div className="space-y-3 rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{t('portIpam.direct')}</p>
      {physical && (
        <div className="space-y-2">
          <FormField label={t('portIpam.mode')} help="mode" guide={t('portIpam.modeGuide')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={port.mode}
                onChange={(e) => setPort({ ...port, mode: e.target.value as Interface['mode'] })}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`portIpam.modes.${m || 'none'}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {(port.mode === 'access' || port.mode === 'hybrid') && (
            <FormField
              label={t('portIpam.accessVlan')}
              help="access"
              hint={
                vlanNumbers && port.accessVlan && !vlanNumbers.has(Number(port.accessVlan)) ? (
                  <Warning>{t('portIpam.vlanUnknown', { vid: port.accessVlan })}</Warning>
                ) : undefined
              }
            >
              {(p) => (
                <div className="flex gap-1">
                  <NativeSelect
                    {...p}
                    value={port.accessVlan}
                    onChange={(e) => setPort({ ...port, accessVlan: e.target.value })}
                  >
                    <option value="">{t('portIpam.noVlan')}</option>
                    {port.accessVlan &&
                      vlanNumbers &&
                      !vlanNumbers.has(Number(port.accessVlan)) && (
                        <option value={port.accessVlan}>{port.accessVlan}</option>
                      )}
                    {(vlans.data ?? []).map((v) => (
                      <option key={v.id} value={String(v.vid)}>
                        {v.vid} · {v.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('portIpam.newVlan')}
                    title={t('portIpam.newVlan')}
                    onClick={() => setCreating('vlan')}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              )}
            </FormField>
          )}
          {(port.mode === 'trunk' || port.mode === 'hybrid') && (
            <div className="grid grid-cols-2 gap-2">
              <FormField
                label={t('portIpam.allowed')}
                hint={t('portIpam.allowedHint')}
                help="allowed-vlans"
              >
                {(p) => (
                  <Input
                    {...p}
                    className="font-mono"
                    value={port.allowedVlans}
                    onChange={(e) => setPort({ ...port, allowedVlans: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('portIpam.native')} help="native-vlan">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={4094}
                    value={port.nativeVlan}
                    onChange={(e) => setPort({ ...port, nativeVlan: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          )}
          {portDirty && (
            <Button size="sm" onClick={savePort} disabled={saveIface.isPending}>
              {t('portIpam.savePort')}
            </Button>
          )}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-label font-medium">{t('portIpam.ips')}</p>
        {ips.length === 0 && <p className="text-xs text-muted-foreground">{t('portIpam.noIps')}</p>}
        <ul className="space-y-0.5">
          {ips.map((ip) => (
            <li key={ip.id} className="flex items-center gap-2">
              <span className="font-mono">{ip.address}</span>
              <span className="text-xs text-muted-foreground">
                {t(`portIpam.roles.${ip.role as 'primary'}`)}
                {ip.vrf && ` · VRF ${ip.vrf}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-6"
                aria-label={t('portIpam.removeIp', { ip: ip.address })}
                onClick={() => dropIp(ip)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <FormField label={t('portIpam.subnet')} help="subnet" guide={t('portIpam.subnetGuide')}>
          {(p) => (
            <div className="flex gap-1">
              <NativeSelect {...p} value={subnetId} onChange={(e) => setSubnetId(e.target.value)}>
                <option value="">{t('portIpam.chooseSubnet')}</option>
                {(subnets.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.cidr}
                    {s.vrf ? ` (VRF ${s.vrf})` : ''}
                    {s.description ? ` · ${s.description}` : ''}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('portIpam.newSubnet')}
                title={t('portIpam.newSubnet')}
                onClick={() => setCreating('subnet')}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          )}
        </FormField>
        <FormField
          label={t('portIpam.address')}
          help="ip"
          hint={warning ? <Warning>{warning}</Warning> : t('portIpam.addressHint')}
        >
          {(p) => (
            <div className="flex gap-1">
              <Input
                {...p}
                className="font-mono"
                placeholder="10.0.0.10/24"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('portIpam.nextFree')}
                title={t('portIpam.nextFree')}
                disabled={!subnetId}
                onClick={() => void nextFree()}
              >
                <Sparkles aria-hidden />
              </Button>
            </div>
          )}
        </FormField>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label={t('portIpam.role')}
            value={effectiveRole}
            onChange={(e) => setRole(e.target.value as 'primary' | 'secondary')}
            className="w-36"
          >
            <option value="primary">{t('portIpam.roles.primary')}</option>
            <option value="secondary">{t('portIpam.roles.secondary')}</option>
          </NativeSelect>
          <Button size="sm" disabled={!address.trim() || saveIp.isPending} onClick={addIp}>
            {t('portIpam.addIp')}
          </Button>
        </div>
      </div>
      {creating === 'vlan' && (
        <VlanDialog
          orgId={orgId}
          defaultSiteId={device.siteId}
          onClose={() => setCreating(null)}
          onSaved={(v) => setPort((cur) => ({ ...cur, accessVlan: String(v.vid) }))}
        />
      )}
      {creating === 'subnet' && (
        <SubnetDialog
          orgId={orgId}
          defaultSiteId={device.siteId}
          onClose={() => setCreating(null)}
          onSaved={(s) => setSubnetId(s.id)}
        />
      )}
    </div>
  )
}
