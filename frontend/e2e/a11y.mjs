// MVP gate (SRS §16 "Dark/Light đạt WCAG AA"): axe-core on the main pages in both themes, against a running instance.
//   NTB_BASE=http://localhost:5173 NTB_SESSION=<ntb_session cookie> NTB_ORG=<org id> node e2e/a11y.mjs
// Exits 1 when a page has a serious / critical violation (WCAG 2 A / AA rules, colour contrast included).
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const base = process.env.NTB_BASE ?? 'http://localhost:5173'
const { NTB_SESSION: session, NTB_ORG: org } = process.env
if (!session || !org) {
  console.error('NTB_SESSION and NTB_ORG are required')
  process.exit(2)
}
const browser = await chromium.launch()
let failed = 0
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([
    { name: 'ntb_session', value: session, domain: new URL(base).hostname, path: '/' },
  ])
  await ctx.addInitScript((t) => localStorage.setItem('ntb-theme', t), theme)
  const page = await ctx.newPage()
  const diagrams = await (await page.request.get(`${base}/api/orgs/${org}/diagrams`)).json()
  const devices = await (
    await page.request.get(`${base}/api/orgs/${org}/devices?pageSize=1`)
  ).json()
  const pages = [
    ['Dashboard', `/o/${org}`],
    ['Thiết bị', `/o/${org}/devices`],
    ['Chi tiết thiết bị', `/o/${org}/devices/${devices.devices[0].id}`],
    ['Sites', `/o/${org}/sites`],
    ['IPAM', `/o/${org}/ipam`],
    ['Sơ đồ', `/o/${org}/diagrams`],
    ['Editor', `/o/${org}/diagrams/${diagrams.diagrams[0].id}`],
    ['Nhập Excel', `/o/${org}/devices/import`],
    ['Thành viên', `/o/${org}/members`],
    ['Audit', `/o/${org}/audit`],
  ]
  for (const [name, path] of pages) {
    await page.goto(base + path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    if (bad.length) failed++
    console.log(`${theme.padEnd(5)} ${name.padEnd(18)} ${bad.length ? 'LỖI' : 'đạt'}`)
    for (const v of bad)
      console.log(
        `      ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes
          .slice(0, 2)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
      )
  }
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
