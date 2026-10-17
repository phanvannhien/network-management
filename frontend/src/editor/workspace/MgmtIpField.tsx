import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, csrfParam, errorMessage } from '@/api/client'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchDevice } from '../doc/api'
import { useDoc, useDocStoreApi } from './context'

/**
 * Management IP typed straight in the property panel (written to the inventory right away, ADR-034): the address
 * goes on the management interface — created when the device has none (Vlan1 on a switch, "mgmt" otherwise).
 * Disabled while the device has an unsaved edit on this diagram, whose management interface would overwrite it.
 */
export function MgmtIpField({
  orgId,
  deviceId,
  current,
}: {
  orgId: string
  deviceId: string
  current: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const store = useDocStoreApi()
  const pending = useDoc((s) => Boolean(s.doc?.deviceEdits[deviceId]))
  const [value, setValue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = value ?? current

  const save = async () => {
    const address = shown.trim()
    if (!address) return
    setBusy(true)
    try {
      const r = await api.PUT('/orgs/{orgId}/devices/{deviceId}/mgmt-ip', {
        params: { ...csrfParam, path: { orgId, deviceId } },
        body: { address },
      })
      if (!r.data) throw new Error(errorMessage(r.error, r.response.status, t('errors.save')))
      toast.success(t('panel.mgmtIpSaved', { ip: r.data.mgmtIp, iface: r.data.interfaceName }))
      for (const w of r.data.warnings) toast.warning(w)
      setValue(null)
      store.getState().syncDevice(deviceId, { mgmtIp: r.data.mgmtIp })
      void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'devices'] })
      void qc.invalidateQueries({ queryKey: ['orgs', orgId, 'ipam'] })
      // The node shows what the server holds (mask from IPAM, cluster VIP rules…).
      void fetchDevice(orgId, deviceId)
        .then((d) => store.getState().syncDevice(deviceId, { mgmtIp: d.mgmtIp }))
        .catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormField
      label={t('devices.mgmtIp')}
      help="mgmt-ip"
      hint={pending ? t('panel.mgmtIpPending') : t('panel.mgmtIpHint')}
    >
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            className="font-mono"
            placeholder="192.168.1.1/24"
            maxLength={50}
            disabled={pending || busy}
            value={shown}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending || busy || shown.trim() === '' || shown.trim() === current}
            onClick={() => void save()}
          >
            {t('panel.mgmtIpSave')}
          </Button>
        </div>
      )}
    </FormField>
  )
}
