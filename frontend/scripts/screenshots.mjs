// UI screenshot tool (docs/ui-screens). Usage:
//   node scripts/screenshots.mjs <pages.json> <outDir>
// Env: BASE_URL (default http://localhost:5180), TOKENS (JSON file mapping session name → cookie value),
//      WIDTHS (comma list, default 1440), THEMES (light,dark).
// pages.json: [{ "name": "members", "path": "/o/<id>/members", "session": "full", "click": "Sửa thông tin" }]
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
        await context.addCookies([{ name: 'ntb_session', value: tokens[p.session], domain: hostname, path: '/' }])
      }
      // Until the theme switcher exists (P1-06) the app only reacts to the .dark class.
      await context.addInitScript((dark) => {
        localStorage.setItem('ntb-theme', dark ? 'dark' : 'light')
        document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('dark', dark))
      }, theme === 'dark')
      const page = await context.newPage()
      await page.goto(base + p.path, { waitUntil: 'networkidle' })
      if (p.click) {
        await page.getByRole('button', { name: p.click }).first().click()
        await page.waitForLoadState('networkidle')
      }
      await page.waitForTimeout(300)
      const file = path.join(outDir, `${p.name}--${width}-${theme}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log(file)
      await context.close()
    }
  }
}
await browser.close()
