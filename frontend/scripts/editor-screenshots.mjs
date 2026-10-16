// Editor screenshots (docs/ui-screens): drops a few devices, links them, selects one, then opens
// the link dialog. Usage: node scripts/editor-screenshots.mjs <outDir>
// Env: BASE_URL (default http://localhost:5180), TOKENS (session cookie JSON, key "full"), W, T.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const tokens = JSON.parse(fs.readFileSync(process.env.TOKENS, 'utf8'))
const out = process.argv[2]
const base = process.env.BASE_URL ?? 'http://localhost:5180'
const b = await chromium.launch()
for (const width of (process.env.W ?? '1440,1280').split(',').map(Number)) {
  for (const theme of (process.env.T ?? 'light,dark').split(',')) {
    const c = await b.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
    await c.addCookies([
      { name: 'ntb_session', value: tokens.full, domain: new URL(base).hostname, path: '/' },
    ])
    await c.addInitScript((t) => localStorage.setItem('ntb-theme', t), theme)
    const p = await c.newPage()
    p.on('pageerror', (e) => console.log('pageerror', e.message))
    await p.goto(base + '/editor', { waitUntil: 'networkidle' })
    const pane = p.locator('.react-flow__pane')
    const drops = [
      ['Firewall', 380, 140],
      ['L3 Switch', 380, 330],
      ['L2 Switch', 220, 520],
      ['PoE Switch', 540, 520],
      ['Server', 760, 330],
    ]
    for (const [i, [label, x, y]] of drops.entries()) {
      await p.getByTitle(new RegExp(`^${label} —`)).dragTo(pane, { targetPosition: { x, y } })
      await p.waitForTimeout(150)
      if (i === 0) {
        // The first node triggers fitView at max zoom: zoom back out to ~1 before the next drops.
        for (let k = 0; k < 8; k++) await p.getByRole('button', { name: 'Thu nhỏ' }).click()
        await p.waitForTimeout(300)
        const n = await p.locator('.react-flow__node').first().boundingBox()
        const pb = await pane.boundingBox()
        drops.forEach((d, j) => {
          if (j > 0) {
            d[1] = n.x - pb.x + (d[1] - x)
            d[2] = n.y - pb.y + (d[2] - y)
          }
        })
      }
    }
    // Drag from a node's bottom handle onto another node, then confirm the port dialog.
    const nodes = p.locator('.react-flow__node')
    const connect = async (from, to, confirm = true) => {
      const src = nodes.nth(from).locator('.react-flow__handle.source')
      const dst = nodes.nth(to)
      const s = await src.boundingBox()
      const d = await dst.boundingBox()
      await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
      await p.mouse.down()
      await p.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 })
      await p.mouse.up()
      await p.waitForTimeout(150)
      const btn = p.getByRole('button', { name: 'Nối', exact: true })
      if (confirm && (await btn.count())) await btn.click()
      await p.waitForTimeout(100)
    }
    await connect(0, 1)
    await connect(1, 2)
    await connect(1, 3)
    await connect(1, 4)
    await p.keyboard.press('Shift+1')
    await p.waitForTimeout(400)
    await nodes.nth(1).click()
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${out}/29-editor--${width}-${theme}.png` })
    await connect(2, 3, false)
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${out}/30-editor-connect--${width}-${theme}.png` })
    await c.close()
  }
}
await b.close()
