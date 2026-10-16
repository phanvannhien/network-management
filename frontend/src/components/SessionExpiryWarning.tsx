import { useQueryClient } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { SESSION_QUERY_KEY, useSession } from '@/app/auth'
import { Button } from '@/components/ui/button'

export const WARN_BEFORE_MS = 2 * 60_000

function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Sticky notice 2 minutes before the session expires (DESIGN.md §6) with "Gia hạn phiên", which
 * re-reads /auth/me (any authenticated request slides the idle expiry). If the expiry does not move,
 * the 7-day absolute limit was reached and the button becomes "Đăng nhập lại".
 */
export function SessionExpiryWarning() {
  const session = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const expiresAt = session.data ? Date.parse(session.data.expiresAt) : NaN
  const [now, setNow] = useState(() => Date.now())
  // Expiry for which extending did not move the deadline (absolute 7-day cap reached).
  const [stuckAt, setStuckAt] = useState<number | null>(null)
  const extendFailed = stuckAt === expiresAt
  const left = expiresAt - now
  const warning = Number.isFinite(left) && left <= WARN_BEFORE_MS

  // Wake up when the warning window opens, then tick every second inside it.
  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return
    const untilWarn = expiresAt - WARN_BEFORE_MS - Date.now()
    const id =
      untilWarn > 0
        ? setTimeout(() => setNow(Date.now()), Math.min(untilWarn, 2 ** 31 - 1))
        : setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(id)
  }, [expiresAt, now])

  // Expired: drop the session; the route guard sends the user to /login?next=….
  useEffect(() => {
    if (Number.isFinite(left) && left <= 0) {
      queryClient.setQueryData(SESSION_QUERY_KEY, null)
      const next = encodeURIComponent(location.pathname + location.search)
      navigate(`/login?next=${next}`, { replace: true })
    }
  }, [left, queryClient, navigate, location])

  if (!warning || left <= 0) return null

  const extend = async () => {
    const before = expiresAt
    await queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY })
    const after = queryClient.getQueryData<{ expiresAt: string } | null>(SESSION_QUERY_KEY)
    if (!after || Date.parse(after.expiresAt) <= before) setStuckAt(before)
    setNow(Date.now())
  }

  return (
    <ExpiryNotice
      leftMs={left}
      absolute={extendFailed}
      onExtend={() => void extend()}
      onSignIn={() => {
        queryClient.setQueryData(SESSION_QUERY_KEY, null)
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
      }}
    />
  )
}

/** Presentational part of the warning (also shown on /dev/ui). */
export function ExpiryNotice({
  leftMs,
  absolute,
  onExtend,
  onSignIn,
}: {
  leftMs: number
  absolute: boolean
  onExtend: () => void
  onSignIn: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-status-warning bg-[color-mix(in_srgb,var(--status-warning)_14%,var(--surface))] px-4 py-1.5"
    >
      <Clock aria-hidden className="size-4 text-status-warning" />
      <span>
        {absolute ? t('session.absolute') : t('session.expiring', { time: formatLeft(leftMs) })}
      </span>
      {absolute ? (
        <Button size="sm" onClick={onSignIn}>
          {t('session.signInAgain')}
        </Button>
      ) : (
        <Button size="sm" onClick={onExtend}>
          {t('session.extend')}
        </Button>
      )}
    </div>
  )
}
