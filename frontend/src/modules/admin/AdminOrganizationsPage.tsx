import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import type { OrganizationKind } from '../../api/client'
import { useSession } from '../../app/auth'
import {
  useAdminCreateOrganization,
  useAdminDeleteOrganization,
  useAdminOrganizations,
} from '../../app/orgs'

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1'

/** System admin: list, create and soft-delete organizations (ADR-023). Server enforces the role. */
export function AdminOrganizationsPage() {
  const session = useSession()
  const orgs = useAdminOrganizations()
  const create = useAdminCreateOrganization()
  const remove = useAdminDeleteOrganization()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OrganizationKind>('customer')
  const [notes, setNotes] = useState('')
  const [addMeAsOwner, setAddMeAsOwner] = useState(true)

  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name, kind, notes, addMeAsOwner },
      {
        onSuccess: () => {
          setName('')
          setNotes('')
        },
      },
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 text-sm text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Quản trị tổ chức</h1>
        <Link to="/" className="text-primary underline">
          Về trang chính
        </Link>
      </div>

      <form
        onSubmit={onCreate}
        className="space-y-2 rounded-lg border border-border p-4"
        aria-label="Tạo tổ chức"
      >
        <h2 className="font-medium">Tạo tổ chức</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-muted-foreground">Tên</span>
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Loại</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as OrganizationKind)}
              className={inputClass}
            >
              <option value="customer">Khách hàng</option>
              <option value="internal">Nội bộ</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-muted-foreground">Ghi chú</span>
          <input
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={addMeAsOwner}
            onChange={(e) => setAddMeAsOwner(e.target.checked)}
          />
          Thêm tôi làm owner (bỏ chọn thì chưa ai truy cập được cho tới khi có thành viên)
        </label>
        {create.isError && (
          <p role="alert" className="text-destructive">
            {create.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
        >
          Tạo
        </button>
      </form>

      {orgs.isError && (
        <p role="alert" className="text-destructive">
          {orgs.error.message}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="text-destructive">
          {remove.error.message}
        </p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">Tên</th>
            <th>Loại</th>
            <th>Thành viên</th>
            <th>Ngày tạo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orgs.data?.map((o) => (
            <tr key={o.id} className="border-b border-border">
              <td className="py-2">{o.name}</td>
              <td>{o.kind === 'customer' ? 'Khách hàng' : 'Nội bộ'}</td>
              <td>{o.memberCount}</td>
              <td>{new Date(o.createdAt).toLocaleDateString('vi-VN')}</td>
              <td className="text-right">
                <button
                  type="button"
                  className="text-destructive underline"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Xóa tổ chức "${o.name}"? Tổ chức sẽ bị ẩn với mọi người; lịch sử vẫn được giữ.`,
                      )
                    ) {
                      remove.mutate(o.id)
                    }
                  }}
                >
                  Xóa
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
