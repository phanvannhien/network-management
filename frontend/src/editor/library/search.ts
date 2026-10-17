// Library search (P1-15): accent-insensitive, so "may chu" finds "Máy chủ".

export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/** Accent-insensitive "every word appears somewhere" match. */
export function matches(query: string, ...fields: string[]): boolean {
  const hay = fold(fields.join(' '))
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}
