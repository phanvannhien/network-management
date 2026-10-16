// UI screenshot tool (docs/ui-screens). Usage:
//   node scripts/screenshots.mjs <pages.json> <outDir>
// Env: BASE_URL (default http://localhost:5180), TOKENS (JSON file mapping session name → cookie value),
//      WIDTHS (comma list, default 1440), THEMES (light,dark).
// pages.json: [{ "name": "members", "path": "/o/<id>/members", "session": "full", "click": "Sửa thông tin",
//   "actions": [{ "click": "Bắt đầu" }, { "fill": "Mã", "value": "123456" }, { "check": "Chọn SW-01" }, { "press": "Control+K" }],
//   "mock": { "POST /api/auth/mfa/enable": { "status": 200, "body": { … } } }, "fullPage": false }]
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const [pagesFile, outDir] = process.argv.slice(2)
if (!pagesFile || !outDir) {
  console.error('usage: node scripts/screenshots.mjs <pages.json> <outDir>')
  process.exit(2)
}
const base = process.env.BASE_URL ?? 'http://localhost:5180'
const tokens = process.env.TOKENS ? JSON.parse(fs.readFileSync(process.env.TOKENS, 'utf8')) : {}
const widths = (process.env.WIDTHS ?? '1440').split(',').map(Number)
const themes = (process.env.THEMES ?? 'light,dark').split(',')
const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'))
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
for (const width of widths) {
  for (const theme of themes) {
    for (const p of pages) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme === 'dark' ? 'dark' : 'light',
        deviceScaleFactor: 1,
      })
      if (p.session) {
        const { hostname } = new URL(base)
        await context.addCookies([
          { name: 'ntb_session', value: tokens[p.session], domain: hostname, path: '/' },
        ])
      }
      // Until the theme switcher exists (P1-06) the app only reacts to the .dark class.
      await context.addInitScript((dark) => {
        localStorage.setItem('ntb-theme', dark ? 'dark' : 'light')
        document.addEventListener('DOMContentLoaded', () =>
          document.documentElement.classList.toggle('dark', dark),
        )
      }, theme === 'dark')
      const page = await context.newPage()
      page.on('pageerror', (e) => console.error(`  ! ${p.name}: ${e.message}`))
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
      const actions = [...(p.click ? [{ click: p.click }] : []), ...(p.actions ?? [])]
      for (const a of actions) {
        if (a.click)
          await page
            .getByRole(a.role ?? 'button', { name: a.click, exact: a.exact ?? true })
            .first()
            .click()
        if (a.fill) await page.getByLabel(a.fill, { exact: true }).first().fill(a.value)
        if (a.check)
          await page.getByRole('checkbox', { name: a.check, exact: true }).first().click()
        if (a.press) await page.keyboard.press(a.press)
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(150)
      }
      await page.waitForTimeout(300)
      const file = path.join(outDir, `${p.name}--${width}-${theme}.png`)
      await page.screenshot({ path: file, fullPage: p.fullPage ?? true })
      console.log(file)
      await context.close()
    }
  }
}
await browser.close()
