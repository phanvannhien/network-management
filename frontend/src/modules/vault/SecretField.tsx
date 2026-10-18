import { Copy, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useMfaVerify } from '@/app/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MfaNeeded, revealSecret } from './vault'

type Target = { credentialId: string } | { accountId: string }

/**
 * Clear the clipboard if it still holds `secret`. Browsers only let a focused page touch the clipboard, and the user
 * has usually switched to the SSH client to paste: then it is tried again when they come back.
 */
function clearClipboard(secret: string) {
  const attempt = async () => {
    try {
      // Only when we can tell it is still ours (reading may be refused: then clear anyway).
      const now = await navigator.clipboard.readText().catch(() => secret)
      if (now === secret) await navigator.clipboard.writeText('')
      return true
    } catch {
      return false
    }
  }
  void attempt().then((done) => {
    if (done) return
    const retry = () => {
      if (document.visibilityState !== 'visible') return
      void attempt().then((ok) => {
        if (!ok) return
        window.removeEventListener('focus', retry)
        document.removeEventListener('visibilitychange', retry)
      })
    }
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
  })
}

/**
 * A stored secret (ADR-018 / ADR-045): masked; "Show" / "Copy" ask the server, which checks the reveal right and a
 * recent MFA code (asked here when needed) and audits the look. Shown secrets hide again, and the clipboard is
 * cleared, after the server's delay (30 s).
 */
export function SecretField({
  orgId,
  target,
  hasSecret,
  canReveal,
  label,
}: {
  orgId: string
  target: Target
  hasSecret: boolean
  canReveal: boolean
  /** What the secret belongs to, for the buttons' names ("Show the password of Switch admin"). */
  label: string
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [askMfa, setAskMfa] = useState<'reveal' | 'copy' | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  if (!hasSecret) return <span className="text-muted-foreground">{t('vault.noSecret')}</span>

  const run = async (action: 'reveal' | 'copy') => {
    setBusy(true)
    try {
      const { secret, clearAfterSeconds } = await revealSecret(orgId, target, action)
      if (action === 'reveal') {
        setShown(secret)
        window.clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(() => setShown(null), clearAfterSeconds * 1000)
      } else {
        await navigator.clipboard.writeText(secret)
        toast.success(t('vault.copied', { seconds: clearAfterSeconds }))
        window.setTimeout(() => clearClipboard(secret), clearAfterSeconds * 1000)
      }
    } catch (err) {
      if (err instanceof MfaNeeded) setAskMfa(action)
      else toast.error(err instanceof Error ? err.message : t('vault.revealFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-mono">{shown ?? '••••••••'}</span>
      {canReveal && (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={
              shown ? t('vault.hideOf', { name: label }) : t('vault.showOf', { name: label })
            }
            onClick={() => (shown ? setShown(null) : void run('reveal'))}
          >
            {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={t('vault.copyOf', { name: label })}
            onClick={() => void run('copy')}
          >
            <Copy aria-hidden />
          </Button>
        </>
      )}
      {askMfa && (
        <MfaPrompt
          onClose={() => setAskMfa(null)}
          onConfirmed={() => {
            const action = askMfa
            setAskMfa(null)
            void run(action)
          }}
        />
      )}
    </span>
  )
}

/** Confirm an MFA code (the session's MFA time is refreshed, then the look is tried again). */
function MfaPrompt({ onClose, onConfirmed }: { onClose: () => void; onConfirmed: () => void }) {
  const { t } = useTranslation()
  const verify = useMfaVerify()
  const [code, setCode] = useState('')
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(
      { code: code.trim() },
      { onSuccess: onConfirmed, onError: (err) => toast.error(err.message) },
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('vault.mfaTitle')}</DialogTitle>
          <DialogDescription>{t('vault.mfaBody')}</DialogDescription>
        </DialogHeader>
        <form id="mfa-step-up" onSubmit={onSubmit}>
          <Input
            aria-label={t('vault.mfaCode')}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="mfa-step-up"
            disabled={code.trim().length < 6 || verify.isPending}
          >
            <ShieldCheck aria-hidden /> {t('vault.mfaConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
