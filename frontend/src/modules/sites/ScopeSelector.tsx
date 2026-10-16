import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { useScope, useScopeStore } from './access'
import { buildTree, flattenTree, useCategories } from './sites'

/** Topbar filter "whole organization / a category branch" (ADR-032); hidden while there is no category. */
export function ScopeSelector({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const categories = useCategories(orgId)
  const scope = useScope(orgId)
  const set = useScopeStore((s) => s.set)
  if (!categories.data?.length) return null
  const rows = flattenTree(buildTree(categories.data))
  return (
    <div className="w-56 max-w-[40vw]">
      <NativeSelect
        aria-label={t('scope.label')}
        className="h-8"
        value={scope.categoryId ?? ''}
        onChange={(e) => set(orgId, { categoryId: e.target.value || null })}
      >
        <option value="">{t('scope.all')}</option>
        {rows.map((c) => (
          <option key={c.id} value={c.id}>
            {'\u00a0\u00a0'.repeat(c.depth)}
            {c.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}
