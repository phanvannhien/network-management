const dateFmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
/** 30/11/2026 */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 09:42 16/10 (built by hand: Intl joins vi-VN day-month with "-" in this combination). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

/** Whole days from `now` until `iso` (negative when past). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / 86_400_000)
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP" (manual TOTP key entry). */
export function groupKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}
