import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { Input } from '@/components/ui/input'
import { fetchDevicePage } from '@/modules/inventory/devices'
import { CREDENTIAL_KINDS } from './vault'

export interface PickedDevice {
  id: string
  hostname: string
  purpose?: string
}

/** Pick devices by hostname / S/N / model; with `purposes`, each one says what the credential is used for there. */
export function DevicePicker({
  orgId,
  value,
  onChange,
  purposes = false,
}: {
  orgId: string
  value: PickedDevice[]
  onChange: (v: PickedDevice[]) => void
  purposes?: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const found = useQuery({
    queryKey: ['orgs', orgId, 'devices', 'vault-pick', search.trim()],
    enabled: search.trim().length >= 2,
    queryFn: () =>
      fetchDevicePage(orgId, {
        q: search.trim(),
        facets: {},
        categoryId: null,
        sort: null,
        pageIndex: 0,
        pageSize: 10,
      }),
  })
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {value.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono">{d.hostname}</span>
            {purposes && (
              <div className="w-36">
                <NativeSelect
                  aria-label={t('vault.purposeOf', { name: d.hostname })}
                  value={d.purpose ?? ''}
                  onChange={(e) =>
                    onChange(
                      value.map((x) => (x.id === d.id ? { ...x, purpose: e.target.value } : x)),
                    )
                  }
                >
                  <option value="">{t('vault.anyPurpose')}</option>
                  {CREDENTIAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vault.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <button
              type="button"
              aria-label={t('contracts.removeDevice', { name: d.hostname })}
              onClick={() => onChange(value.filter((x) => x.id !== d.id))}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <Input
        aria-label={t('contracts.searchDevice')}
        placeholder={t('contracts.searchDevice')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim().length >= 2 && (
        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {(found.data?.devices ?? [])
            .filter((d) => !value.some((x) => x.id === d.id))
            .map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange([...value, { id: d.id, hostname: d.hostname, purpose: '' }])
                    setSearch('')
                  }}
                >
                  <Plus aria-hidden className="size-3.5" />
                  <span className="font-mono">{d.hostname}</span>
                  <span className="text-muted-foreground">
                    {d.siteCode} · {d.model}
                  </span>
                </button>
              </li>
            ))}
          {found.data && found.data.devices.length === 0 && (
            <li className="px-2 py-1 text-sm text-muted-foreground">
              {t('contracts.noDeviceFound')}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
