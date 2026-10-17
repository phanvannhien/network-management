import * as XLSX from 'xlsx'

// Spreadsheet → plain text grid (P1-21). Everything is read as the text the user sees (S/N keep leading zeros, IPs
// stay strings); merged cells (a "Site" written once for many rows) are filled into every row they cover.

export interface Sheet {
  name: string
  rows: string[][]
}

export function readWorkbook(data: ArrayBuffer): Sheet[] {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellText: true })
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]!
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }) as string[][]
    for (const m of ws['!merges'] ?? []) {
      const v = rows[m.s.r]?.[m.s.c] ?? ''
      for (let r = m.s.r; r <= m.e.r; r++)
        for (let c = m.s.c; c <= m.e.c; c++) {
          rows[r] ??= []
          if (!rows[r]![c]) rows[r]![c] = v
        }
    }
    return { name, rows: rows.map((r) => Array.from(r, (c) => clean(c))) }
  })
}

/** Trim, drop non-breaking spaces and line breaks inside cells. */
export const clean = (v: unknown) =>
  String(v ?? '')
    .replace(/[\u00a0\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Lowercase, no Vietnamese diacritics (đ → d), letters and digits only: "Ip Address mgmt" → "ipaddressmgmt". */
export const norm = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
