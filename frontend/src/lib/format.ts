const dateFmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** 30/11/2026 */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

/** 09:42 16/10 */
export function formatDateTime(iso: string): string {
  return timeFmt.format(new Date(iso))
}

/** Whole days from `now` until `iso` (negative when past). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / 86_400_000)
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP" (manual TOTP key entry). */
export function groupKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}
