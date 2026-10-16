import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthCard, inputClass, primaryButtonClass, safeNext } from './AuthCard'
import { mfaStep, useLogout, useMfaVerify, useSession } from './auth'

/** Second sign-in step: TOTP code from the authenticator app, or a one-time recovery code. */
export function MfaVerifyPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const session = useSession()
  const verify = useMfaVerify()
  const logout = useLogout()
  const [useRecovery, setUseRecovery] = useState(false)
  const [value, setValue] = useState('')

  if (session.isPending) return null
  if (!session.data) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  if (mfaStep(session.data) !== 'verify' && !verify.isSuccess) return <Navigate to={next} replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(useRecovery ? { recoveryCode: value } : { code: value }, {
      onSuccess: () => navigate(next, { replace: true }),
    })
  }

  return (
    <AuthCard title="Xác thực hai lớp">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">
            {useRecovery ? 'Mã khôi phục' : 'Mã 6 số từ ứng dụng xác thực'}
          </span>
          <input
            key={useRecovery ? 'recovery' : 'totp'}
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
        </label>
        {verify.isError && (
          <p role="alert" className="text-sm text-destructive">
            {verify.error.message}
          </p>
        )}
        <button type="submit" disabled={verify.isPending} className={primaryButtonClass}>
          {verify.isPending ? 'Đang kiểm tra…' : 'Xác nhận'}
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground underline hover:text-foreground"
          onClick={() => {
            setUseRecovery(!useRecovery)
            setValue('')
          }}
        >
          {useRecovery ? 'Dùng mã từ ứng dụng' : 'Dùng mã khôi phục'}
        </button>
        <button
          type="button"
          className="text-muted-foreground underline hover:text-foreground"
          onClick={() => logout.mutate()}
        >
          Đăng xuất
        </button>
      </div>
    </AuthCard>
  )
}
