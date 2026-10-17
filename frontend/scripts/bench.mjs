// Performance check (P1-25, SRS §14) against a running instance: diagram open time, drag FPS, device list filter
// and API timings for an organization seeded with `make seed-bench`.
//
//   NTB_BASE=http://localhost:5173 NTB_SESSION=<ntb_session cookie> NTB_ORG=<org id> node scripts/bench.mjs
//
// The session cookie is copied from the browser (DevTools › Application › Cookies) of a member of the organization.
import { chromium } from 'playwright'

const base = process.env.NTB_BASE ?? 'http://localhost:5173'
const session = process.env.NTB_SESSION
const org = process.env.NTB_ORG
if (!session || !org) {
  console.error('NTB_SESSION and NTB_ORG are required')
  process.exit(2)
}
const host = new URL(base).hostname

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await ctx.addCookies([{ name: 'ntb_session', value: session, domain: host, path: '/' }])
const page = await ctx.newPage()
const api = async (path) => {
  const t0 = performance.now()
  const r = await page.request.get(`${base}/api/orgs/${org}${path}`)
  const ms = performance.now() - t0
  if (!r.ok()) throw new Error(`${path}: ${r.status()}`)
  return { body: await r.json(), ms }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const results = {}

const diagrams = (await api('/diagrams')).body.diagrams
const diagram = diagrams.sort((a, b) => b.nodeCount - a.nodeCount)[0] ?? diagrams[0]

// 1. Open the diagram: navigation → every node drawn.
await page.goto(`${base}/o/${org}/devices`)
const t0 = Date.now()
await page.goto(`${base}/o/${org}/diagrams/${diagram.id}`)
await page.locator('.react-flow__node').first().waitFor({ timeout: 60_000 })
await page.waitForFunction(
  () =>
    document.querySelectorAll('.react-flow__node').length > 0 &&
    [...document.querySelectorAll('.react-flow__node')].every(
      (n) => n.style.visibility !== 'hidden',
    ),
  null,
  { timeout: 60_000 },
)
results.openMs = Date.now() - t0
results.nodes = await page.locator('.react-flow__node').count()
results.edges = await page.locator('.react-flow__edge').count()

// 2. Drag: time from each pointer move to the next painted frame (median → FPS), with the whole drawing in view
//    and at a working zoom (about 1×). Headless Chromium paints without a GPU: a real browser does better.
const dragSteps = () =>
  page.evaluate(async () => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
    const el = [...document.querySelectorAll('.react-flow__node-device')].find((n) => {
      const r = n.getBoundingClientRect()
      return (
        r.x > pane.x + 50 &&
        r.y > pane.y + 50 &&
        r.right < pane.right - 300 &&
        r.bottom < pane.bottom - 150
      )
    })
    if (!el) return null
    const r = el.getBoundingClientRect()
    const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, buttons: 1, view: window })
    el.dispatchEvent(new MouseEvent('mousedown', at(r.x + 20, r.y + 20)))
    const out = []
    for (let i = 1; i <= 30; i++) {
      const t0 = performance.now()
      for (const target of [window, document])
        target.dispatchEvent(new MouseEvent('mousemove', at(r.x + 20 + i * 4, r.y + 20 + i * 3)))
      await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))
      out.push(performance.now() - t0)
    }
    for (const target of [window, document])
      target.dispatchEvent(new MouseEvent('mouseup', at(r.x, r.y)))
    return out.slice(5)
  })
const fps = (steps) => (steps ? Math.min(60, Math.round(1000 / median(steps))) : null)
results.dragFpsAllInView = fps(await dragSteps())
await page.keyboard.press('Control+z')
await page.mouse.move(800, 500)
const zoomNow = async () =>
  Number(
    (await page.locator('.react-flow__viewport').getAttribute('style')).match(
      /scale\(([\d.]+)\)/,
    )[1],
  )
await page.keyboard.down('Control')
for (let i = 0; i < 20 && (await zoomNow()) < 0.9; i++) {
  await page.mouse.wheel(0, -40)
  await page.waitForTimeout(100)
}
await page.keyboard.up('Control')
await page.waitForTimeout(500)
results.zoom = (await zoomNow()).toFixed(2)
results.nodesInViewAtZoom = await page.locator('.react-flow__node-device').count()
results.dragFpsAtZoom = fps(await dragSteps())
await page.keyboard.press('Control+z')

// 3. Click → selection shown (a node clear of the toolbars).
const c0 = await page.evaluate(() => {
  const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
  const el = [...document.querySelectorAll('.react-flow__node-device:not(.selected)')].find((n) => {
    const r = n.getBoundingClientRect()
    return (
      r.x > pane.x + 50 &&
      r.y > pane.y + 50 &&
      r.right < pane.right - 300 &&
      r.bottom < pane.bottom - 150
    )
  })
  el.setAttribute('data-bench', 'pick')
  return true
})
if (c0) {
  const s0 = Date.now()
  await page.locator('[data-bench="pick"]').click()
  await page.locator('.react-flow__node.selected').first().waitFor()
  results.selectMs = Date.now() - s0
}

// 4. Device list: type a filter, wait for the table to change.
await page.goto(`${base}/o/${org}/devices`)
await page.locator('tbody tr').first().waitFor()
const search = page.getByRole('searchbox').first()
const f0 = Date.now()
await Promise.all([
  page.waitForResponse((r) => r.url().includes('/devices?') && r.url().includes('q=SW-S00')),
  search.fill('SW-S00'),
])
await page.waitForFunction(() =>
  [...document.querySelectorAll('tbody tr')].every((r) => r.textContent.includes('SW-S00')),
)
results.listFilterMs = Date.now() - f0

// 5. API timings (median of 5).
for (const [key, path] of [
  ['searchMs', '/search?q=10.20.3'],
  ['dashboardMs', '/dashboard'],
  ['devicePageMs', '/devices?q=core&pageSize=50'],
  ['diagramLoadMs', `/diagrams/${diagram.id}`],
]) {
  const runs = []
  for (let i = 0; i < 5; i++) runs.push((await api(path)).ms)
  results[key] = Math.round(median(runs))
}

console.log(JSON.stringify({ diagram: diagram.name, ...results }, null, 2))
await browser.close()
