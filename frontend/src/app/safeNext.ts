/**
 * Only same-app paths are allowed as post-auth redirects (no open redirect via ?next=). "//host", "/\host" (browsers
 * read a backslash as a slash) and control characters are refused (P2-14).
 */
export function safeNext(next: string | null): string {
  // eslint-disable-next-line no-control-regex
  return next && /^\/(?![/\\])/.test(next) && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : '/'
}
