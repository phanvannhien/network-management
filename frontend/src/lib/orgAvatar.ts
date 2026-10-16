/**
 * Organization avatar: initials + a fixed colour per organization (DESIGN.md §6).
 * The palette avoids status hues (green/red/amber); white text is ≥ 5.89:1 on every entry.
 */
export const ORG_COLORS = [
  '#0B6F79', // teal
  '#2458A6', // blue
  '#4A4FB0', // indigo
  '#8A3F7E', // plum
  '#A1461D', // rust
  '#4A5868', // slate
  '#5B6620', // olive
  '#7A5230', // cocoa
] as const

/** Stable colour for an organization id (FNV-1a hash, so the same org keeps its colour everywhere). */
export function orgColor(id: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ORG_COLORS[(h >>> 0) % ORG_COLORS.length]
}

/** First letters of the first two words ("Văn phòng mẫu" → "VP"); one word → its first two letters. */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters =
    words.length === 1
      ? Array.from(words[0]).slice(0, 2)
      : [words[0], words[1]].map((w) => Array.from(w)[0])
  return letters.join('').toLocaleUpperCase('vi')
}
