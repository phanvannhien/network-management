import { describe, expect, it } from 'vitest'
import {
  DPI,
  fitImage,
  pixelRatioFor,
  sheetLayout,
  titleBlockElement,
  type TitleBlock,
} from './exportPdf'

describe('PDF sheet layout (P2-11)', () => {
  it('A3 landscape: 10 mm margins, title block bottom-right, drawing above it', () => {
    const L = sheetLayout('a3', 'landscape')
    expect([L.width, L.height]).toEqual([420, 297])
    expect(L.frame).toEqual({ x: 10, y: 10, w: 400, h: 277 })
    expect(L.title.x + L.title.w).toBe(410)
    expect(L.title.y + L.title.h).toBe(287)
    // The drawing never runs under the title block.
    expect(L.drawing.y + L.drawing.h).toBeLessThanOrEqual(L.title.y)
  })

  it('A4 portrait swaps the sides and keeps the title block inside the frame', () => {
    const L = sheetLayout('a4', 'portrait')
    expect([L.width, L.height]).toEqual([210, 297])
    expect(L.title.w).toBeLessThanOrEqual(L.frame.w)
    expect(L.title.x).toBeGreaterThanOrEqual(L.frame.x)
  })

  it('fits a wide drawing to the width, centred vertically', () => {
    const area = { x: 0, y: 0, w: 400, h: 200 }
    const f = fitImage(area, 4000, 1000)
    expect(f.w).toBeCloseTo(400)
    expect(f.h).toBeCloseTo(100)
    expect(f.y).toBeCloseTo(50)
    expect(f.mmPerPx).toBeCloseTo(0.1)
  })

  it('does not blow a small drawing up past twice its screen size', () => {
    const f = fitImage({ x: 0, y: 0, w: 400, h: 250 }, 300, 200)
    expect(f.mmPerPx).toBeCloseTo(0.53)
    expect(f.w).toBeLessThan(400)
    expect(f.x).toBeGreaterThan(0)
  })

  it('captures at print resolution', () => {
    // 0.1 mm per CSS px at 300 DPI: 300 / 25.4 dots per mm × 0.1 mm.
    expect(pixelRatioFor(0.1)).toBeCloseTo((DPI / 25.4) * 0.1)
  })

  it('title block shows every field, black on white', () => {
    const labels = {
      org: 'Tổ chức',
      sites: 'Site',
      title: 'Sơ đồ',
      drawingNo: 'Số bản vẽ',
      revision: 'Phiên bản',
      date: 'Ngày',
      drawnBy: 'Người lập',
      checkedBy: 'Người kiểm tra',
      sheet: 'Tờ',
      scale: 'Tỉ lệ',
      classification: 'Mức bảo mật',
    }
    const tb: TitleBlock = {
      org: 'Công ty A',
      sites: 'HCM01',
      title: 'LAN — Tầng 1',
      drawingNo: 'HCM01-NET-001',
      revision: 'B',
      date: '18/10/2026',
      drawnBy: 'Nhiên',
      checkedBy: '',
      sheet: '1 / 2',
      scale: 'Không theo tỉ lệ',
      classification: 'Nội bộ',
      labels,
    }
    const el = titleBlockElement(tb, 170, 32)
    expect(el.style.width).toBe('680px')
    expect(el.style.background).toMatch(/#fff|rgb\(255, 255, 255\)/)
    for (const v of [
      'Công ty A',
      'HCM01',
      'LAN — Tầng 1',
      'HCM01-NET-001',
      '1 / 2',
      'Không theo tỉ lệ',
      'Nội bộ',
    ])
      expect(el.textContent).toContain(v)
    for (const l of Object.values(labels)) expect(el.textContent).toContain(l)
  })
})
