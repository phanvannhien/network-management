import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api, errorMessage } from '../api/client'
import { AuthCard, inputClass, primaryButtonClass } from './AuthCard'

/** Public page for one-time links: accept an invitation or reset a password (P1-04). */
export function AcceptInvitePage() {
  const { token = '' } = useParams()
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const info = useQuery({
    queryKey: ['account-token', token],
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/account-tokens/{token}', { params: { path: { token } } })
      if (r.data) return r.data
      throw new Error(errorMessage(r.error, r.response.status, 'Link không hợp lệ'))
    },
  })
  const accept = useMutation({
    mutationFn: async () => {
      const r = await api.POST('/account-tokens/{token}', {
        params: { path: { token } },
        body: { displayName, password },
      })
      if (r.response.status === 204) return
      throw new Error(errorMessage(r.error, r.response.status, 'Không đặt được mật khẩu'))
    },
  })

  if (info.isPending) return null
  if (info.isError) {
    return (
      <AuthCard title="Link không dùng được">
        <p role="alert" className="text-sm text-destructive">
          {info.error.message}
        </p>
        <p className="text-sm text-muted-foreground">Hãy nhờ quản trị viên gửi link mới.</p>
      </AuthCard>
    )
  }
  const isInvite = info.data.purpose === 'invite'
  if (accept.isSuccess) {
    return (
      <AuthCard title="Hoàn tất">
        <p className="text-sm">Mật khẩu đã được đặt cho {info.data.email}.</p>
        <Link to="/login" className={primaryButtonClass + ' block text-center'}>
          Đăng nhập
        </Link>
      </AuthCard>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setMismatch(password !== confirm)
    if (password === confirm) accept.mutate()
  }

  return (
    <AuthCard title={isInvite ? 'Kích hoạt tài khoản' : 'Đặt lại mật khẩu'}>
      <p className="text-sm text-muted-foreground">
        {info.data.email}
        {isInvite && info.data.organizations.length > 0 && (
          <> · tổ chức: {info.data.organizations.join(', ')}</>
        )}
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        {isInvite && (
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">Họ tên</span>
            <input
              required
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">Mật khẩu mới (tối thiểu 12 ký tự)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">Nhập lại mật khẩu</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </label>
        {(mismatch || accept.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {mismatch ? 'Hai mật khẩu không khớp' : accept.error?.message}
          </p>
        )}
        <button type="submit" disabled={accept.isPending} className={primaryButtonClass}>
          {isInvite ? 'Kích hoạt' : 'Đặt mật khẩu'}
        </button>
      </form>
    </AuthCard>
  )
}
