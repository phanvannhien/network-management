import type { ReactNode } from 'react'

export const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring'
export const primaryButtonClass =
  'w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'

/** Centered card used by the sign-in and MFA screens. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <section
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
        aria-labelledby="auth-card-title"
      >
        <h1 id="auth-card-title" className="text-xl font-semibold">
          {title}
        </h1>
        {children}
      </section>
    </main>
  )
}

/** Only same-app paths are allowed as post-auth redirects (no open redirect via ?next=). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
