import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthCard, inputClass, primaryButtonClass, safeNext } from './AuthCard'
import { SESSION_QUERY_KEY, useMfaEnable, useMfaSetup, useSession } from './auth'

/**
 * TOTP enrollment: QR code → confirm with a code → show recovery codes once.
 * Mandatory for system admins and organization owners/admins (ADR-019); optional for others.
 */
export function MfaSetupPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useSession()
  const setup = useMfaSetup()
  const enable = useMfaEnable()
  const [code, setCode] = useState('')

  if (session.isPending) return null
  if (!session.data) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  // Already enrolled and not in the middle of showing freshly issued codes.
  if (session.data.mfa.enabled && !enable.data) return <Navigate to={next} replace />

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    navigate(next, { replace: true })
  }

  if (enable.data) {
    const text = enable.data.join('\n')
    return (
      <AuthCard title="Lưu mã khôi phục">
        <p className="text-sm text-muted-foreground">
          Mỗi mã dùng được một lần khi bạn mất điện thoại. Mã chỉ hiện{' '}
          <strong>một lần duy nhất</strong> — hãy lưu ở nơi an toàn.
        </p>
        <ul
          className="grid grid-cols-2 gap-1 rounded-md border border-border p-3 font-mono text-sm"
          aria-label="Mã khôi phục"
        >
          {enable.data.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className="underline"
            onClick={() => void navigator.clipboard?.writeText(text)}
          >
            Sao chép
          </button>
          <a
            className="underline"
            download="ntb-recovery-codes.txt"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + '\n')}`}
          >
            Tải file .txt
          </a>
        </div>
        <button type="button" className={primaryButtonClass} onClick={() => void finish()}>
          Tôi đã lưu mã, tiếp tục
        </button>
      </AuthCard>
    )
  }

  const onConfirm = (e: FormEvent) => {
    e.preventDefault()
    enable.mutate(code)
  }

  return (
    <AuthCard title="Thiết lập xác thực hai lớp">
      {session.data.mfa.required && (
        <p className="text-sm text-muted-foreground">
          Tài khoản quản trị bắt buộc dùng MFA trước khi tiếp tục.
        </p>
      )}
      {!setup.data ? (
        <>
          <p className="text-sm text-muted-foreground">
            Cần một ứng dụng xác thực (Google Authenticator, Microsoft Authenticator, 1Password,
            Bitwarden…).
          </p>
          {setup.isError && (
            <p role="alert" className="text-sm text-destructive">
              {setup.error.message}
            </p>
          )}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={setup.isPending}
            onClick={() => setup.mutate()}
          >
            {setup.isPending ? 'Đang tạo mã…' : 'Bắt đầu'}
          </button>
        </>
      ) : (
        <form onSubmit={onConfirm} className="space-y-4">
          <p className="text-sm">1. Quét mã QR bằng ứng dụng xác thực:</p>
          <img
            src={setup.data.qrCode}
            alt="Mã QR thiết lập MFA"
            className="mx-auto size-48 rounded bg-white p-2"
          />
          <p className="text-xs text-muted-foreground">
            Không quét được? Nhập khóa:{' '}
            <code className="break-all font-mono">{setup.data.secret}</code>
          </p>
          <label className="block space-y-1">
            <span className="text-sm">2. Nhập mã 6 số đang hiện trong ứng dụng:</span>
            <input
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </label>
          {enable.isError && (
            <p role="alert" className="text-sm text-destructive">
              {enable.error.message}
            </p>
          )}
          <button type="submit" disabled={enable.isPending} className={primaryButtonClass}>
            {enable.isPending ? 'Đang kiểm tra…' : 'Bật MFA'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
