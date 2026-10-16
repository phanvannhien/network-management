// Accessibility check (DESIGN.md §3.3): axe-core WCAG 2.1 A/AA on real pages, Light + Dark,
// plus a keyboard pass (Tab through the page, every focused element must show a focus indicator).
// Usage: node scripts/a11y.mjs <pages.json> <report.md>   (same pages.json/env as screenshots.mjs)
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const [pagesFile, reportFile] = process.argv.slice(2)
const base = process.env.BASE_URL ?? 'http://localhost:5180'
const tokens = process.env.TOKENS ? JSON.parse(fs.readFileSync(process.env.TOKENS, 'utf8')) : {}
const themes = (process.env.THEMES ?? 'light,dark').split(',')
const tabs = Number(process.env.TABS ?? 25)
const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'))

const browser = await chromium.launch()
const lines = [
  '# Kiểm tra truy cập (axe-core + bàn phím)',
  '',
  `Chạy: ${new Date().toISOString()} · ${base}`,
  '',
]
let total = 0
for (const theme of themes) {
  for (const p of pages) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    })
    if (p.session) {
      await context.addCookies([
        {
          name: 'ntb_session',
          value: tokens[p.session],
          domain: new URL(base).hostname,
          path: '/',
        },
      ])
    }
    await context.addInitScript((t) => localStorage.setItem('ntb-theme', t), theme)
    const page = await context.newPage()
    for (const [key, res] of Object.entries(p.mock ?? {})) {
      const [method, route] = key.split(' ')
      await page.route(base + route, (r) =>
        r.request().method() === method
          ? r.fulfill({
              status: res.status,
              contentType: 'application/json',
              body: JSON.stringify(res.body),
            })
          : r.continue(),
      )
    }
    await page.goto(base + p.path, { waitUntil: 'networkidle' })
    for (const a of p.actions ?? []) {
      if (a.click)
        await page
          .getByRole(a.role ?? 'button', { name: a.click, exact: a.exact ?? true })
          .first()
          .click()
      if (a.fill) await page.getByLabel(a.fill, { exact: true }).first().fill(a.value)
      if (a.check) await page.getByRole('checkbox', { name: a.check, exact: true }).first().click()
      if (a.press) await page.keyboard.press(a.press)
      await page.waitForTimeout(200)
    }
    await page.waitForTimeout(300)
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    // Keyboard: Tab through and check each focused element has a visible indicator.
    const noFocusRing = []
    if (!p.actions?.some((a) => a.press)) {
      await page
        .locator('body')
        .click({ position: { x: 1, y: 1 } })
        .catch(() => {})
      for (let i = 0; i < tabs; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return null
          const cs = getComputedStyle(el)
          const visible =
            (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
            (cs.boxShadow && cs.boxShadow !== 'none') ||
            cs.borderColor !== getComputedStyle(el.parentElement ?? el).borderColor
          const name = (el.getAttribute('aria-label') || el.textContent || el.tagName)
            .trim()
            .slice(0, 40)
          return { visible, name: `${el.tagName.toLowerCase()} "${name}"` }
        })
        if (info && !info.visible) noFocusRing.push(info.name)
      }
    }

    total += result.violations.length + noFocusRing.length
    const status = result.violations.length === 0 && noFocusRing.length === 0 ? '✅' : '❌'
    lines.push(`## ${status} ${p.name} — ${theme}`)
    for (const v of result.violations) {
      lines.push(`- **${v.id}** (${v.impact}): ${v.help} — ${v.nodes.length} phần tử`)
      for (const n of v.nodes.slice(0, 3))
        lines.push(
          `  - \`${n.target.join(' ')}\` ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`,
        )
    }
    for (const n of noFocusRing) lines.push(`- **focus**: không thấy chỉ báo focus trên ${n}`)
    console.log(
      `${status} ${p.name} ${theme}: ${result.violations.length} axe, ${noFocusRing.length} focus`,
    )
    await context.close()
  }
}
lines.splice(3, 0, `Tổng vấn đề: **${total}**`, '')
fs.writeFileSync(reportFile, lines.join('\n') + '\n')
await browser.close()
process.exit(total === 0 ? 0 : 1)
