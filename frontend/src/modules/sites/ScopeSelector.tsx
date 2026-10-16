import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { useBusinessUnits, usePartners } from './sites'
import { useScope, useScopeStore } from './access'

/** Topbar filter "All / partner / unit" (ADR-031); hidden while the organization has no partners. */
export function ScopeSelector({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const partners = usePartners(orgId)
  const units = useBusinessUnits(orgId)
  const scope = useScope(orgId)
  const set = useScopeStore((s) => s.set)
  if (!partners.data?.length) return null
  const value = scope.unitId ? `u:${scope.unitId}` : scope.partnerId ? `p:${scope.partnerId}` : ''
  return (
    <div className="w-56 max-w-[40vw]">
      <NativeSelect
        aria-label={t('scope.label')}
        className="h-8"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v.startsWith('u:')) {
            const unit = units.data?.find((u) => u.id === v.slice(2))
            set(orgId, { partnerId: unit?.partnerId ?? null, unitId: v.slice(2) })
          } else {
            set(orgId, { partnerId: v.startsWith('p:') ? v.slice(2) : null, unitId: null })
          }
        }}
      >
        <option value="">{t('scope.all')}</option>
        {partners.data.map((p) => (
          <optgroup key={p.id} label={`${p.code} · ${p.name}`}>
            <option value={`p:${p.id}`}>{t('scope.wholePartner', { code: p.code })}</option>
            {(units.data ?? [])
              .filter((u) => u.partnerId === p.id)
              .map((u) => (
                <option key={u.id} value={`u:${u.id}`}>
                  {p.code} › {u.code} · {u.name}
                </option>
              ))}
          </optgroup>
        ))}
      </NativeSelect>
    </div>
  )
}
