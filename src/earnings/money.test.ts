import { describe, expect, it } from 'vitest'
import { formatCents, parsePositiveCents, parseWithholdingBps } from './money'

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
})
