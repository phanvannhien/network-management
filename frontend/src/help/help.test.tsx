import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import {
  ARTICLE_BY_SLUG,
  ARTICLES,
  parseArticle,
  searchArticles,
  visibleArticles,
} from './articles'
import { GLOSSARY_BY_ID } from './glossary'
import { inline, linkTarget, Markdown, parseMarkdown, slugify, type Block } from './markdown'

const html = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe('help markdown (P2-24)', () => {
  it('parses headings with Vietnamese anchors, nested lists, code inside a list, tables, notes, directives', () => {
    const blocks = parseMarkdown(`## Sao lưu đích
Đoạn **đậm** và \`mã\`.

1. Mount NAS.
2. Gắn vào container:
   \`\`\`yaml
   volumes: [a]
   \`\`\`
   - con một
   - con hai
3. Xong.

| Cột | Giá trị |
| --- | --- |
| a \\| b | c |

> **Lưu ý:** cất key.

::: shortcuts

## Sao lưu đích`)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2, id: 'sao-luu-dich' })
    const list = blocks.find((b) => b.kind === 'list') as Extract<Block, { kind: 'list' }>
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(3)
    expect(list.items[1]!.children.map((c) => c.kind)).toEqual(['code', 'list'])
    expect(blocks.find((b) => b.kind === 'table')).toMatchObject({
      head: ['Cột', 'Giá trị'],
      rows: [['a | b', 'c']],
    })
    expect(blocks.some((b) => b.kind === 'note')).toBe(true)
    expect(blocks.some((b) => b.kind === 'directive' && b.name === 'shortcuts')).toBe(true)
    expect(blocks.at(-1)).toMatchObject({ id: 'sao-luu-dich-2' })
  })

  it('links: help articles and app paths stay inside, http opens a new tab, anything else is plain text', () => {
    expect(linkTarget('help:ipam#vlan')).toEqual({ internal: '/help/ipam#vlan' })
    expect(linkTarget('/help/glossary')).toEqual({ internal: '/help/glossary' })
    expect(linkTarget('https://rclone.org')).toEqual({ external: 'https://rclone.org' })
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'vbscript:x'])
      expect(linkTarget(bad)).toBeNull()
    const out = html(
      <>{inline('[xấu](javascript:alert(1)) [tốt](https://rclone.org) <b>thẻ</b>')}</>,
    )
    expect(out).not.toContain('javascript:')
    expect(out).toContain('target="_blank"')
    // Text that looks like HTML stays text.
    expect(out).toContain('&lt;b&gt;thẻ&lt;/b&gt;')
  })

  it('renders directives from the given components', () => {
    expect(
      html(<Markdown blocks={parseMarkdown('::: demo')} components={{ demo: <i>live</i> }} />),
    ).toBe('<i>live</i>')
  })

  it('slugs fold Vietnamese', () => {
    expect(slugify('Đích lưu — chọn theo cỡ khách')).toBe('dich-luu-chon-theo-co-khach')
  })
})

describe('help articles', () => {
  it('every article has a title, a section and a summary; slugs are unique', () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(10)
    for (const a of ARTICLES) {
      expect(a.title, a.slug).not.toBe(a.slug)
      expect(a.summary, a.slug).not.toBe('')
      expect(['start', 'guides', 'admin']).toContain(a.section)
    }
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length)
  })

  it('every link between articles points at an existing article and heading; glossary links at a term', () => {
    const links: string[] = []
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        const texts =
          b.kind === 'list'
            ? b.items.map((i) => i.text)
            : b.kind === 'table'
              ? [...b.head, ...b.rows.flat()]
              : 'text' in b
                ? [b.text]
                : []
        for (const t of texts) for (const m of t.matchAll(/\]\(([^)\s]+)\)/g)) links.push(m[1]!)
        if (b.kind === 'list') for (const i of b.items) walk(i.children)
      }
    }
    for (const a of ARTICLES) walk(a.blocks)
    for (const href of links) {
      if (href.startsWith('help:')) {
        const [slug, anchor] = href.slice(5).split('#')
        const target = ARTICLE_BY_SLUG.get(slug!)
        expect(target, href).toBeDefined()
        if (anchor)
          expect(
            target!.headings.map((h) => h.id),
            href,
          ).toContain(anchor)
      } else if (href.startsWith('/help/glossary#')) {
        expect(GLOSSARY_BY_ID.has(href.split('#')[1]!), href).toBe(true)
      }
    }
    expect(links.length).toBeGreaterThan(10)
  })

  it('admin articles are for system admins only', () => {
    const admin = ARTICLES.filter((a) => a.section === 'admin').map((a) => a.slug)
    expect(admin).toEqual(expect.arrayContaining(['cai-dat-nang-cap', 'sao-luu-khoi-phuc']))
    expect(visibleArticles(false).some((a) => a.section === 'admin')).toBe(false)
    expect(visibleArticles(true).map((a) => a.slug)).toEqual(expect.arrayContaining(admin))
  })

  it('search ignores accents and points at the heading', () => {
    const hits = searchArticles(visibleArticles(true), 'object lock')
    expect(hits[0]?.article.slug).toBe('sao-luu-khoi-phuc')
    expect(hits[0]?.anchor).not.toBe('')
    expect(
      searchArticles(visibleArticles(true), 'nhap excel').map((h) => h.article.slug),
    ).toContain('ipam')
    expect(searchArticles(visibleArticles(false), 'object lock')).toEqual([])
    expect(searchArticles(ARTICLES, 'x')).toEqual([])
  })

  it('front matter: unknown section falls back to guides', () => {
    const a = parseArticle(
      'x',
      '---\ntitle: T: phụ\nsection: other\norder: 3 # comment\n---\n## A\n',
    )
    expect(a).toMatchObject({ title: 'T: phụ', section: 'guides', order: 3 })
  })
})
