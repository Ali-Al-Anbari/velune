import { describe, expect, it } from 'vitest'
import { formatCents, parseNonnegativeCents, parsePositiveCents, parseWithholdingBps } from './money'

describe('integer money input', () => {
  it('parses exact cents and rejects invalid or oversized wages and tips', () => {
    expect(parsePositiveCents('18.50')).toBe(1850)
    expect(parsePositiveCents('0.01')).toBe(1)
    for (const value of ['', '0', '-1', '1.005', '10000.01', 'abc']) expect(parsePositiveCents(value)).toBeNull()
    expect(formatCents(1850)).toBe('$18.50')
  })

  it('parses optional withholding into basis points', () => {
    expect(parseWithholdingBps('')).toBeNull()
    expect(parseWithholdingBps('15.25')).toBe(1525)
    expect(parseWithholdingBps('100')).toBe(10000)
    expect(Number.isNaN(parseWithholdingBps('100.01'))).toBe(true)
    expect(Number.isNaN(parseWithholdingBps('1.234'))).toBe(true)
  })

  it('parses manual withholding in cents, distinguishes blank from zero, and formats negative results', () => {
    expect(parseNonnegativeCents('')).toBeNull()
    expect(parseNonnegativeCents('0')).toBe(0)
    expect(parseNonnegativeCents('12.3')).toBe(1230)
    expect(parseNonnegativeCents('12.34')).toBe(1234)
    for (const value of ['-0.01', '1.005', '10000.01', 'abc']) expect(Number.isNaN(parseNonnegativeCents(value))).toBe(true)
    expect(formatCents(-25)).toBe('−$0.25')
  })
})
