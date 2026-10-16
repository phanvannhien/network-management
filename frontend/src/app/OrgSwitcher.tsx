import { useNavigate } from 'react-router'
import { useMyOrganizations } from './orgs'

/** Organization switcher (SRS §2). Switching = navigating to another /o/{orgId}; other tabs are unaffected (ADR-023). */
export function OrgSwitcher({ currentOrgId }: { currentOrgId: string }) {
  const orgs = useMyOrganizations()
  const navigate = useNavigate()
  if (!orgs.data || orgs.data.length < 2) return null

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Tổ chức</span>
      <select
        value={currentOrgId}
        onChange={(e) => navigate(`/o/${e.target.value}`)}
        className="rounded-md border border-border bg-background px-2 py-1"
      >
        {orgs.data.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  )
}
