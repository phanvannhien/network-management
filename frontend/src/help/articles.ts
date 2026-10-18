import { parseMarkdown, plainText, slugify, type Block } from './markdown'

// Help articles (P2-24): Markdown files in docs/help/, bundled at build time — the same files are read on GitHub and
// in the app (self-hosted installs often have no internet). Each starts with front matter:
//
//   ---
//   title: Sao lưu & khôi phục
//   section: admin        # start | guides | admin (admin = system admins only)
//   order: 2
//   summary: one line shown in lists and search
//   ---

export type HelpSection = 'start' | 'guides' | 'admin'

export interface HelpArticle {
  slug: string
  title: string
  section: HelpSection
  order: number
  summary: string
  blocks: Block[]
  /** Headings (level 2–3) for the table of contents and search anchors. */
  headings: { id: string; text: string; level: number }[]
  text: string
}

const SECTIONS: HelpSection[] = ['start', 'guides', 'admin']

/** Splits front matter from the body (simple "key: value" lines). */
export function parseArticle(slug: string, raw: string): HelpArticle {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split('\n')) {
    const [k, ...v] = line.split(':')
    if (k && v.length)
      meta[k.trim()] = v
        .join(':')
        .replace(/\s+#.*$/, '')
        .trim()
  }
  const blocks = parseMarkdown(m?.[2] ?? raw)
  const section = SECTIONS.includes(meta.section as HelpSection)
    ? (meta.section as HelpSection)
    : 'guides'
  return {
    slug,
    title: meta.title || slug,
    section,
    order: Number(meta.order) || 99,
    summary: meta.summary ?? '',
    blocks,
    headings: blocks.flatMap((b) =>
      b.kind === 'heading' && b.level >= 2 && b.level <= 3
        ? [{ id: b.id, text: b.text, level: b.level }]
        : [],
    ),
    text: plainText(blocks),
  }
}

const files = import.meta.glob('../../../docs/help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const ARTICLES: HelpArticle[] = Object.entries(files)
  .map(([path, raw]) => parseArticle(path.split('/').pop()!.replace(/\.md$/, ''), raw))
  .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order)

export const ARTICLE_BY_SLUG = new Map(ARTICLES.map((a) => [a.slug, a]))

/** The articles a user may read: admin ones for system admins only. */
export function visibleArticles(isSystemAdmin: boolean): HelpArticle[] {
  return ARTICLES.filter((a) => a.section !== 'admin' || isSystemAdmin)
}

const fold = (s: string) => slugify(s).replace(/-/g, ' ')

export interface SearchHit {
  article: HelpArticle
  /** Heading the match is under ("" = the top). */
  anchor: string
  snippet: string
}

/** Articles containing every word of the query (accents and case ignored), title matches first. */
export function searchArticles(list: HelpArticle[], query: string): SearchHit[] {
  const words = fold(query)
    .split(' ')
    .filter((w) => w.length > 1)
  if (words.length === 0) return []
  const hits: (SearchHit & { score: number })[] = []
  for (const a of list) {
    const hay = fold(`${a.title} ${a.summary} ${a.text}`)
    if (!words.every((w) => hay.includes(w))) continue
    const title = fold(a.title)
    const score =
      words.filter((w) => title.includes(w)).length * 10 +
      words.filter((w) => fold(a.summary).includes(w)).length
    // Snippet: the first line of the text holding the first word, and the heading above it.
    const lines = a.text.split('\n')
    const at = lines.findIndex((l) => fold(l).includes(words[0]!))
    const line = at >= 0 ? lines[at]! : a.summary
    let anchor = ''
    if (at >= 0) {
      for (let i = at; i >= 0; i--) {
        const h = a.headings.find((x) => x.text.replace(/`|\*\*/g, '') === lines[i])
        if (h) {
          anchor = h.id
          break
        }
      }
    }
    hits.push({
      article: a,
      anchor,
      snippet: line.length > 180 ? `${line.slice(0, 177)}…` : line,
      score,
    })
  }
  return hits.sort((x, y) => y.score - x.score)
}
