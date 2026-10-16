import { describe, expect, it } from 'vitest'
import { placeCode } from './placeCode'

describe('placeCode', () => {
  it('knows the usual provinces inside longer names', () => {
    expect(placeCode('Nhà máy Bình Định')).toBe('BD')
    expect(placeCode('Chi nhánh Hà Nội')).toBe('HN')
    expect(placeCode('HoChiMinh')).not.toBe('')
    expect(placeCode('Ho Chi Minh')).toBe('HCM')
    expect(placeCode('Hưng Yên')).toBe('HY')
    expect(placeCode('Biên Hòa')).toBe('BH')
  })
  it('falls back to initials (2–4 letters)', () => {
    expect(placeCode('Kho Tổng Miền Tây')).toBe('KTMT')
    expect(placeCode('Xyz')).toBe('XYZ')
    expect(placeCode('')).toBe('')
  })
})
