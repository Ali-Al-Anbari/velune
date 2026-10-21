import { shiftTotals, type ShiftRecord } from '../shift/time'

const millisecondsPerHour = 3_600_000n

export type ShiftEarnings = {
  grossWagesCents: number | null
  totalTipsCents: number | null
  tipTaxWithheldCents: number | null
  grossEarningsCents: number | null
  tipsAfterWithholdingCents: number | null
  earningsAfterTipWithholdingCents: number | null
}

export function calculateShiftEarnings(shift: ShiftRecord, nowMs: number): ShiftEarnings {
  const workedMs = shiftTotals(shift, nowMs).workedMs
  const rate = shift.hourly_wage_cents_snapshot
  const grossWagesCents = rate == null
    ? null
    : Number((BigInt(workedMs) * BigInt(rate) + millisecondsPerHour / 2n) / millisecondsPerHour)
  const totalTipsCents = shift.tips == null ? null : shift.tips.reduce((total, tip) => total + tip.amount_cents, 0)
  const tipTaxWithheldCents = shift.tip_tax_withheld_cents ?? null
  const effectiveWithholding = tipTaxWithheldCents ?? 0
  const grossEarningsCents = grossWagesCents == null || totalTipsCents == null ? null : grossWagesCents + totalTipsCents

  return {
    grossWagesCents,
    totalTipsCents,
    tipTaxWithheldCents,
    grossEarningsCents,
    tipsAfterWithholdingCents: totalTipsCents == null ? null : totalTipsCents - effectiveWithholding,
    earningsAfterTipWithholdingCents: grossEarningsCents == null ? null : grossEarningsCents - effectiveWithholding,
  }
}
