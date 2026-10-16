import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useSession } from '../../app/auth'
import { accountLink, useAdminPasswordReset, useAdminUserAction, useAdminUsers } from './members'

/** System admin: all users — disable/enable, reset MFA, issue password-reset links (P1-04). */
export function AdminUsersPage() {
  const session = useSession()
  const users = useAdminUsers()
  const action = useAdminUserAction()
  const reset = useAdminPasswordReset()
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null)

  if (session.data && !session.data.user.isSystemAdmin) return <Navigate to="/" replace />
  const error = action.error ?? reset.error ?? users.error

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 text-sm text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Quản trị người dùng</h1>
        <Link to="/" className="text-primary underline">
          Về trang chính
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      {resetLink && (
        <div role="status" className="space-y-2 rounded-md border border-border bg-muted p-3">
          <p>Link đặt lại mật khẩu cho {resetLink.email} (dùng một lần, hết hạn sau 24 giờ):</p>
          <code className="block break-all font-mono text-xs">{resetLink.link}</code>
          <div className="flex gap-3">
            <button
              type="button"
              className="underline"
              onClick={() => void navigator.clipboard?.writeText(resetLink.link)}
            >
              Sao chép
            </button>
            <button type="button" className="underline" onClick={() => setResetLink(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">Người dùng</th>
            <th>Tổ chức</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id} className="border-b border-border align-top">
              <td className="py-2">
                <div>
                  {u.displayName || '(chưa kích hoạt)'}
                  {u.isSystemAdmin && (
                    <span className="text-muted-foreground"> · system admin</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td>{u.organizationCount}</td>
              <td className="text-xs">
                {u.disabled ? 'Đã vô hiệu hóa' : u.pendingInvite ? 'Chờ kích hoạt' : 'Hoạt động'} ·
                MFA {u.mfaEnabled ? 'bật' : 'tắt'}
              </td>
              <td className="space-y-1 text-right text-xs">
                <button
                  type="button"
                  className="block w-full text-right underline"
                  onClick={() =>
                    action.mutate({ userId: u.id, action: u.disabled ? 'enable' : 'disable' })
                  }
                >
                  {u.disabled ? 'Kích hoạt lại' : 'Vô hiệu hóa'}
                </button>
                {u.mfaEnabled && (
                  <button
                    type="button"
                    className="block w-full text-right underline"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Reset MFA của ${u.email}? Người này phải thiết lập lại ở lần đăng nhập tới.`,
                        )
                      ) {
                        action.mutate({ userId: u.id, action: 'reset-mfa' })
                      }
                    }}
                  >
                    Reset MFA
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full text-right underline"
                  onClick={() =>
                    reset.mutate(u.id, {
                      onSuccess: (t) => setResetLink({ email: u.email, link: accountLink(t) }),
                    })
                  }
                >
                  Link đặt lại mật khẩu
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
