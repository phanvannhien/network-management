import { Copy, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText } from '@/lib/clipboard'
import { MfaCodeInput } from './MfaCodeInput'

export const SECRET_VISIBLE_MS = 30_000
export const CLIPBOARD_CLEAR_MS = 30_000
export const MFA_FRESH_MS = 5 * 60_000

type Action = 'show' | 'copy'

/**
 * Masked secret with Show / Copy (ADR-018, DESIGN.md §8b).
 * - MFA older than 5 minutes → asks for a fresh code first, then carries on with the action.
 * - Shown value re-masks after 30 s with a countdown; copied value is wiped from the clipboard
 *   after 30 s.
 * - The value is fetched on demand (`reveal`, an audited API call) and never put into attributes.
 */
export function SecretField({
  label,
  reveal,
  mfaVerifiedAt,
  verifyMfa,
}: {
  /** Field name, e.g. "Mật khẩu admin" (used for accessible names, never the value). */
  label: string
  reveal: () => Promise<string>
  /** ISO time of the last MFA check in this session (AuthSession.mfa.verifiedAt). */
  mfaVerifiedAt: string | null | undefined
  /** Verifies a TOTP code; rejects on a wrong code. */
  verifyMfa: (code: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const verifiedAt = useRef<number | null>(mfaVerifiedAt ? Date.parse(mfaVerifiedAt) : null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-mask countdown: one tick per second while the value is shown.
  const shown = value !== null
  useEffect(() => {
    if (!shown) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) setValue(null)
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [shown])

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current)
    },
    [],
  )

  const mfaFresh = () =>
    verifiedAt.current !== null && Date.now() - verifiedAt.current < MFA_FRESH_MS

  const run = async (action: Action) => {
    setBusy(true)
    try {
      const secret = await reveal()
      if (action === 'show') {
        setValue(secret)
        setRemaining(SECRET_VISIBLE_MS / 1000)
      } else if (await copyText(secret)) {
        toast.success(t('secret.copied'))
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => {
          void copyText('').then((ok) => ok && toast(t('secret.cleared')))
        }, CLIPBOARD_CLEAR_MS)
      }
    } finally {
      setBusy(false)
    }
  }

  const request = (action: Action) => {
    if (mfaFresh()) void run(action)
    else {
      setCode('')
      setCodeError(null)
      setPendingAction(action)
    }
  }

  const submitCode = async (c: string) => {
    setBusy(true)
    try {
      await verifyMfa(c)
      verifiedAt.current = Date.now()
      const action = pendingAction
      setPendingAction(null)
      if (action) await run(action)
    } catch {
      setCodeError(t('secret.wrongCode'))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex min-w-0 items-center gap-1">
      <KeyRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {value === null ? (
        <>
          <span aria-hidden className="font-mono text-tech text-muted-foreground">
            ••••••••••
          </span>
          <span className="sr-only">{`${label}: ${t('secret.masked')}`}</span>
        </>
      ) : (
        <span className="font-mono text-tech break-all" data-secret>
          {value}
        </span>
      )}
      {value === null ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => request('show')}
          aria-label={`${t('secret.show')} ${label}`}
        >
          <Eye aria-hidden /> {t('secret.show')}
        </Button>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => setValue(null)}>
          <EyeOff aria-hidden /> {t('secret.hide', { seconds: remaining })}
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        onClick={() => request('copy')}
        aria-label={`${t('secret.copy')} ${label}`}
      >
        <Copy aria-hidden /> {t('secret.copy')}
      </Button>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('secret.mfaTitle')}</DialogTitle>
            <DialogDescription>{t('secret.mfaDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.length === 6) void submitCode(code)
            }}
          >
            <MfaCodeInput
              autoFocus
              aria-label={t('auth.mfaCode')}
              value={code}
              onChange={setCode}
              onComplete={(c) => void submitCode(c)}
              disabled={busy}
            />
            {codeError && (
              <p role="alert" className="text-label text-destructive">
                {codeError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {t('secret.confirm')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
