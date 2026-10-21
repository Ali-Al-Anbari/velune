import { describe, expect, it } from 'vitest'
import type { ShiftRecord } from '../shift/time'
import { calculateShiftEarnings } from './shiftEarnings'

const shift: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a', started_at: '2026-10-21T09:00:00Z',
  ended_at: '2026-10-21T10:00:00Z', breaks: [
    { id: 'paid', shift_id: 'shift-a', started_at: '2026-10-21T09:00:00Z', ended_at: '2026-10-21T09:15:00Z', is_paid: true },
    { id: 'unpaid', shift_id: 'shift-a', started_at: '2026-10-21T09:15:00Z', ended_at: '2026-10-21T09:30:00Z', is_paid: false },
  ],
  hourly_wage_cents_snapshot: 1850,
  tips: [{ id: 'tip-a', shift_id: 'shift-a', amount_cents: 2520, label: 'Cash', created_at: '', updated_at: '' }],
}

describe('shift earnings', () => {
  it('calculates gross wages with unpaid breaks excluded and rounds cents half up', () => {
    const result = calculateShiftEarnings(shift, 0)
    expect(result.grossWagesCents).toBe(1388)
    expect(result.totalTipsCents).toBe(2520)
    expect(result.grossEarningsCents).toBe(3908)
  })

  it('leaves unentered withholding distinct from explicit zero and never uses profile estimates', () => {
    const noEntry = calculateShiftEarnings({
      ...shift, include_tips_in_tax_estimate_snapshot: true, estimated_withholding_bps_snapshot: 5000,
    }, 0)
    expect(noEntry.tipTaxWithheldCents).toBeNull()
    expect(noEntry.tipsAfterWithholdingCents).toBe(2520)
    expect(noEntry.earningsAfterTipWithholdingCents).toBe(3908)

    const explicitZero = calculateShiftEarnings({ ...shift, tip_tax_withheld_cents: 0 }, 0)
    expect(explicitZero.tipTaxWithheldCents).toBe(0)
    expect(explicitZero.tipsAfterWithholdingCents).toBe(2520)
    expect(explicitZero.earningsAfterTipWithholdingCents).toBe(3908)
  })

  it('subtracts manually entered withholding and recalculates when tips change', () => {
    const withWithholding = calculateShiftEarnings({ ...shift, tip_tax_withheld_cents: 125 }, 0)
    expect(withWithholding.tipsAfterWithholdingCents).toBe(2395)
    expect(withWithholding.earningsAfterTipWithholdingCents).toBe(3783)

    const updatedTips = calculateShiftEarnings({
      ...shift,
      tip_tax_withheld_cents: 125,
      tips: [{ ...shift.tips![0]!, amount_cents: 3020 }],
    }, 0)
    expect(updatedTips.tipsAfterWithholdingCents).toBe(2895)
    expect(updatedTips.grossEarningsCents).toBe(4408)
    expect(updatedTips.earningsAfterTipWithholdingCents).toBe(4283)
  })

  it('does not invent gross wages for legacy shifts without a saved wage snapshot', () => {
    const result = calculateShiftEarnings({ ...shift, hourly_wage_cents_snapshot: null }, 0)
    expect(result.grossWagesCents).toBeNull()
    expect(result.grossEarningsCents).toBeNull()
    expect(result.earningsAfterTipWithholdingCents).toBeNull()
  })
})
