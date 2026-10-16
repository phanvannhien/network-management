/** Only same-app paths are allowed as post-auth redirects (no open redirect via ?next=). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
