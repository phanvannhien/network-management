import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MfaPrompt } from '@/modules/vault/SecretField'
import { MfaNeeded } from '@/modules/vault/vault'

/**
 * Step-up MFA for sensitive actions (P2-14): when the server answers 428 the action throws MfaNeeded; `guard` shows
 * the code prompt and runs the action again once the code is confirmed.
 */
export function useStepUp(): {
  guard: (err: unknown, again: () => void) => boolean
  prompt: ReactNode
} {
  const { t } = useTranslation()
  const [retry, setRetry] = useState<(() => void) | null>(null)
  return {
    guard: (err, again) => {
      if (!(err instanceof MfaNeeded)) return false
      setRetry(() => again)
      return true
    },
    prompt: retry && (
      <MfaPrompt
        title={t('stepUp.title')}
        body={t('stepUp.body')}
        onClose={() => setRetry(null)}
        onConfirmed={() => {
          const again = retry
          setRetry(null)
          again()
        }}
      />
    ),
  }
}

/** Throws MfaNeeded on a 428 answer (the server wants a fresh MFA code). */
export function mfaGate(status: number, message: string) {
  if (status === 428) throw new MfaNeeded(message)
}
