import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

// A small Markdown renderer for the help articles (P2-24): headings, paragraphs, nested lists, code blocks, tables,
// notes (> …), inline code / bold / links, and ":::name" directives for live components. Everything becomes React
// elements — no HTML from the text is ever injected. Links: "help:slug#anchor" (another article), "/app/path",
// "#anchor", http(s) (new tab); anything else (javascript:, data:…) stays plain text.

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'note'; text: string }
  | { kind: 'directive'; name: string }

export interface ListItem {
  text: string
  children: Block[]
}

/** Anchor id of a heading: lower case, no diacritics, dashes. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[`*[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const indentOf = (line: string) => line.length - line.trimStart().length
const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

/** Parses Markdown text (front matter already removed) into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  return parseLines(lines, 0)
}

function parseLines(lines: string[], base: number): Block[] {
  const out: Block[] = []
  let i = 0
  const ids = new Map<string, number>()
  while (i < lines.length) {
    const raw = lines[i]!
    const line = raw.slice(Math.min(base, indentOf(raw)))
    const t = line.trim()
    if (t === '') {
      i++
      continue
    }
    const fence = t.match(/^```(\w*)/)
    if (fence) {
      const body: string[] = []
      const ind = indentOf(raw)
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        body.push(lines[i]!.slice(Math.min(ind, indentOf(lines[i]!))))
        i++
      }
      i++
      out.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') })
      continue
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      let id = slugify(h[2]!)
      const n = ids.get(id) ?? 0
      ids.set(id, n + 1)
      if (n > 0) id = `${id}-${n + 1}`
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]!, id })
      i++
      continue
    }
    const dir = t.match(/^:::\s*([\w-]+)\s*$/)
    if (dir) {
      out.push({ kind: 'directive', name: dir[1]! })
      i++
      continue
    }
    if (t.startsWith('|') && lines[i + 1]?.trim().match(/^\|?\s*:?-{3,}/)) {
      const head = cells(t)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!))
      out.push({ kind: 'table', head, rows })
      continue
    }
    if (t.startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('>'))
        body.push(lines[i++]!.trim().replace(/^>\s?/, ''))
      out.push({ kind: 'note', text: body.join(' ') })
      continue
    }
    const li = raw.match(LIST_RE)
    if (li) {
      const ordered = /\d/.test(li[2]!)
      const ind = li[1]!.length
      const items: ListItem[] = []
      while (i < lines.length) {
        const m = lines[i]!.match(LIST_RE)
        if (!m || m[1]!.length !== ind || /\d/.test(m[2]!) !== ordered) break
        const text = [m[3]!]
        const child: string[] = []
        i++
        // Lines indented deeper belong to the item: continuation text or nested blocks.
        while (i < lines.length && (lines[i]!.trim() === '' || indentOf(lines[i]!) > ind)) {
          if (lines[i]!.trim() === '' && !(lines[i + 1] && indentOf(lines[i + 1]!) > ind)) break
          if (
            child.length === 0 &&
            !LIST_RE.test(lines[i]!) &&
            !lines[i]!.trim().startsWith('```') &&
            lines[i]!.trim() !== ''
          )
            text.push(lines[i]!.trim())
          else child.push(lines[i]!)
          i++
        }
        items.push({
          text: text.join(' '),
          children: child.length ? parseLines(child, ind + 2) : [],
        })
      }
      out.push({ kind: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i]!.trim()
      if (l === '' || /^(#{1,4}\s|```|\||>|:::)/.test(l) || LIST_RE.test(lines[i]!)) break
      para.push(l)
      i++
    }
    out.push({ kind: 'para', text: para.join(' ') })
  }
  return out
}

/** Safe target of a link, or null (shown as plain text). */
export function linkTarget(href: string): { internal: string } | { external: string } | null {
  if (href.startsWith('help:')) {
    const [slug, anchor] = href.slice(5).split('#')
    return { internal: `/help/${slug}${anchor ? `#${anchor}` : ''}` }
  }
  if (href.startsWith('/') && !href.startsWith('//')) return { internal: href }
  if (href.startsWith('#')) return { internal: href }
  if (/^https?:\/\//i.test(href)) return { external: href }
  return null
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g

/** Inline Markdown: `code`, **bold**, [text](href). */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (m[1]) {
      out.push(
        <code key={k++} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (m[2]) {
      out.push(<strong key={k++}>{inline(tok.slice(2, -2))}</strong>)
    } else {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!
      const target = linkTarget(href!)
      if (!target) out.push(label)
      else if ('internal' in target)
        out.push(
          <Link
            key={k++}
            to={target.internal}
            className="text-primary underline-offset-2 hover:underline"
          >
            {inline(label!)}
          </Link>,
        )
      else
        out.push(
          <a
            key={k++}
            href={target.external}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {inline(label!)}
          </a>,
        )
    }
    last = m.index! + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renders parsed blocks; directives come from `components`. */
export function Markdown({
  blocks,
  components = {},
}: {
  blocks: Block[]
  components?: Record<string, ReactNode>
}) {
  return <>{blocks.map((b, i) => renderBlock(b, i, components))}</>
}

function renderBlock(b: Block, key: number, components: Record<string, ReactNode>): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const cls = [
        '',
        'text-2xl font-semibold',
        'mt-6 text-lg font-semibold',
        'mt-4 text-base font-semibold',
        'mt-3 font-semibold',
      ][b.level]
      const Tag = (['h1', 'h1', 'h2', 'h3', 'h4'] as const)[b.level]!
      return (
        <Tag key={key} id={b.id} className={`scroll-mt-4 ${cls}`}>
          {inline(b.text)}
        </Tag>
      )
    }
    case 'para':
      return (
        <p key={key} className="leading-relaxed">
          {inline(b.text)}
        </p>
      )
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={key} className={`${b.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-6`}>
          {b.items.map((it, j) => (
            <li key={j} className="leading-relaxed">
              {inline(it.text)}
              {it.children.length > 0 && (
                <div className="mt-1 space-y-2">
                  {it.children.map((c, n) => renderBlock(c, n, components))}
                </div>
              )}
            </li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed"
        >
          <code>{b.text}</code>
        </pre>
      )
    case 'table':
      return (
        <div key={key} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                {b.head.map((h, j) => (
                  <th key={j} className="px-2 py-1 font-medium">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j} className="border-t border-border align-top">
                  {r.map((c, n) => (
                    <td key={n} className="px-2 py-1">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'note':
      return (
        <aside
          key={key}
          className="rounded-md border-l-4 border-primary bg-primary/5 px-3 py-2 text-sm leading-relaxed"
        >
          {inline(b.text)}
        </aside>
      )
    case 'directive':
      return <Fragment key={key}>{components[b.name] ?? null}</Fragment>
  }
}

/** Plain text of blocks (search index). */
export function plainText(blocks: Block[]): string {
  const strip = (s: string) => s.replace(/`|\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading':
        case 'para':
        case 'note':
          return strip(b.text)
        case 'list':
          return b.items.map((it) => `${strip(it.text)} ${plainText(it.children)}`).join(' ')
        case 'code':
          return b.text
        case 'table':
          return [...b.head, ...b.rows.flat()].map(strip).join(' ')
        default:
          return ''
      }
    })
    .join('\n')
}
