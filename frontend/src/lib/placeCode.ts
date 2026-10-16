/**
 * Place abbreviation for site codes (ADR-030): known Vietnamese provinces/cities first, otherwise the
 * initials of the words (accents removed), clipped to 2–4 letters.
 */
const KNOWN: Record<string, string> = {
  'ha noi': 'HN',
  'ho chi minh': 'HCM',
  hcm: 'HCM',
  'sai gon': 'HCM',
  'da nang': 'DN',
  'hai phong': 'HP',
  'can tho': 'CT',
  'binh duong': 'BDG',
  'dong nai': 'DNI',
  'bien hoa': 'BH',
  'ben cat': 'BC',
  'hung yen': 'HY',
  'vinh long': 'VL',
  'binh dinh': 'BD',
  'bac ninh': 'BN',
  'hai duong': 'HD',
  'quang ninh': 'QN',
  'nghe an': 'NA',
  'thanh hoa': 'TH',
  'khanh hoa': 'KH',
  'nha trang': 'NT',
  'long an': 'LA',
  'ba ria vung tau': 'BRVT',
  'vung tau': 'VT',
  'tay ninh': 'TN',
  'lam dong': 'LD',
  'da lat': 'DL',
  hue: 'HUE',
  'quang nam': 'QNM',
  'vinh phuc': 'VP',
  'thai nguyen': 'TNG',
  'nam dinh': 'ND',
  'ninh binh': 'NB',
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
}

export function placeCode(text: string): string {
  const norm = stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm) return ''
  // Longest known name contained in the text wins ("Nhà máy Bình Định" → BD, "CN Hà Nội" → HN).
  const hit = Object.keys(KNOWN)
    .sort((a, b) => b.length - a.length)
    .find((k) => ` ${norm} `.includes(` ${k} `))
  if (hit) return KNOWN[hit]
  const words = norm.split(' ').filter((w) => /^[a-z]/.test(w))
  const initials = words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  if (initials.length >= 2) return initials.slice(0, 4)
  return (words[0] ?? '').slice(0, 3).toUpperCase().padEnd(2, 'X')
}
