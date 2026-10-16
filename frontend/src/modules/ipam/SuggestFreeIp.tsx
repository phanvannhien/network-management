import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { fetchNextFree, useSubnets, type Subnet } from './ipam'

/**
 * Picks the next free address of a subnet of the device's site (or an organization-wide one) and hands it
 * to the IP form with the subnet's VRF (P1-10, SRS §5 "gợi ý IP trống").
 */
export function SuggestFreeIp({
  orgId,
  siteId,
  onPick,
}: {
  orgId: string
  siteId: string | null
  onPick: (address: string, subnet: Subnet) => void
}) {
  const { t } = useTranslation()
  const subnets = useSubnets(orgId, '', '')
  const [chosen, setChosen] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const options = (subnets.data ?? []).filter((s) => s.siteId === null || s.siteId === siteId)
  if (options.length === 0) return null
  const pick = (id: string) => {
    setChosen(id)
    setMessage(null)
    const subnet = options.find((s) => s.id === id)
    if (!subnet) return
    fetchNextFree(orgId, id).then(
      (address) => {
        if (address) {
          onPick(address, subnet)
          setMessage({ ok: true, text: t('ipam.suggested', { address }) })
        } else setMessage({ ok: false, text: t('ipam.noFree') })
      },
      (e: Error) => setMessage({ ok: false, text: e.message }),
    )
  }
  return (
    <FormField
      label={t('ipam.suggestFrom')}
      help="ipam"
      hint={
        message ? (
          <span aria-live="polite" className={message.ok ? undefined : 'text-status-down'}>
            {message.text}
          </span>
        ) : (
          t('ipam.nextFreeHint')
        )
      }
    >
      {(p) => (
        <NativeSelect {...p} value={chosen} onChange={(e) => pick(e.target.value)}>
          <option value="">{t('ipam.chooseSubnet')}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.cidr}
              {s.vlanVid !== null && s.vlanVid !== undefined ? ` · VLAN ${s.vlanVid}` : ''}
              {s.description ? ` · ${s.description}` : ''}
              {s.vrf ? ` · VRF ${s.vrf}` : ''}
            </option>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
