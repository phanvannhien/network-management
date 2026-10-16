import { Link, Navigate } from 'react-router'
import { useSession } from './auth'
import { useMyOrganizations } from './orgs'

/** "/" → the organization used last (if still a member) or the first one; explains when there is none. */
export function RootRedirect() {
  const session = useSession()
  const orgs = useMyOrganizations()

  if (orgs.isPending) return <p className="p-6 text-sm text-muted-foreground">Đang tải…</p>
  if (orgs.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {orgs.error.message}
      </p>
    )
  }
  const active = session.data?.activeOrganizationId
  const target = orgs.data.find((o) => o.id === active) ?? orgs.data[0]
  if (target) return <Navigate to={`/o/${target.id}`} replace />

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
      <h1 className="text-xl font-semibold">Bạn chưa thuộc tổ chức nào</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Liên hệ quản trị viên để được thêm vào một tổ chức.
      </p>
      {session.data?.user.isSystemAdmin && (
        <Link to="/admin/organizations" className="text-sm text-primary underline">
          Quản trị tổ chức
        </Link>
      )}
    </main>
  )
}
