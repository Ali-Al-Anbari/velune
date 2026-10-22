import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShiftRecord } from '../shift/time'
import { calculateShiftEarnings } from './shiftEarnings'
import { calculateEarningsReport } from './reports'
import { dateKeyOffset, monthPeriod, periodContainsToday, reportPeriodBounds, weekPeriod, type ReportPeriod } from './reportPeriods'

const runtime = globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }
const env = runtime.process?.env
let originalTimezone: string | undefined

function iso(localDateTime: string) { return new Date(localDateTime).toISOString() }
function period(startDate: string, endDate = startDate): ReportPeriod { return { startDate, endDate } }
function shift(start: string, end: string, extra: Partial<ShiftRecord> = {}): ShiftRecord {
  const id = extra.id ?? 'shift-a'
  return {
    id, user_id: 'user-a', started_at: iso(start), ended_at: iso(end), breaks: [], tips: [],
    hourly_wage_cents_snapshot: 2000, wage_profile_name_snapshot: 'Day shift', ...extra,
  }
}

beforeEach(() => {
  if (!env) throw new Error('Node test environment is required for report timezone tests.')
  originalTimezone = env.TZ
  env.TZ = 'America/New_York'
})
afterEach(() => {
  if (!env) return
  if (originalTimezone === undefined) delete env.TZ
  else env.TZ = originalTimezone
})

describe('earnings report periods', () => {
  it('uses Monday through Sunday local calendar weeks and navigates over Sunday-to-Monday', () => {
    expect(weekPeriod(new Date('2026-10-18T16:00:00-04:00'))).toEqual(period('2026-10-12', '2026-10-18'))
    expect(weekPeriod(new Date('2026-10-19T09:00:00-04:00'))).toEqual(period('2026-10-19', '2026-10-25'))
    expect(dateKeyOffset('2026-10-18', 1)).toBe('2026-10-19')
  })

  it('builds month and year boundaries as local half-open intervals', () => {
    expect(monthPeriod(new Date('2026-12-15T12:00:00-05:00'))).toEqual(period('2026-12-01', '2026-12-31'))
    const bounds = reportPeriodBounds(period('2026-12-31', '2027-01-01'))
    expect(bounds.startAt.toISOString()).toBe('2026-12-31T05:00:00.000Z')
    expect(bounds.endExclusive.toISOString()).toBe('2027-01-02T05:00:00.000Z')
    expect(periodContainsToday(period('2026-10-01', '2026-10-31'), new Date('2026-10-21T12:00:00-04:00'))).toBe(true)
  })
})

describe('earnings report allocation', () => {
  it('uses the existing rounded shift earnings for a normal shift and preserves withholding null versus zero', () => {
    const item = shift('2026-10-21T09:00', '2026-10-21T17:00', {
      breaks: [{ id: 'unpaid', shift_id: 'shift-a', started_at: iso('2026-10-21T12:00'), ended_at: iso('2026-10-21T12:30'), is_paid: false }],
      tips: [{ id: 'tip', shift_id: 'shift-a', amount_cents: 2000, label: 'Cash', created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-02T00:00:00Z' }],
      tip_tax_withheld_cents: null,
    })
    const result = calculateEarningsReport([item], period('2026-10-21'), Date.parse('2026-10-22T00:00:00Z'))
    const wholeShift = calculateShiftEarnings(item, Date.parse('2026-10-22T00:00:00Z'))
    expect(result.workedMs).toBe(7.5 * 3_600_000)
    expect(result.grossWagesCents).toBe(wholeShift.grossWagesCents)
    expect(result.knownGrossWagesCents).toBe(wholeShift.grossWagesCents)
    expect(result.knownWageShiftCount).toBe(1)
    expect(result.missingWageShiftCount).toBe(0)
    expect(result.totalTipsCents).toBe(2000)
    expect(result.tipTaxWithheldCents).toBeNull()
    expect(result.grossEarningsCents).toBe((wholeShift.grossWagesCents ?? 0) + 2000)
    expect(result.earningsAfterTipWithholdingCents).toBe(result.grossEarningsCents)

    const zero = calculateEarningsReport([{ ...item, tip_tax_withheld_cents: 0 }], period('2026-10-21'), Date.parse('2026-10-22T00:00:00Z'))
    expect(zero.tipTaxWithheldCents).toBe(0)
  })

  it('splits an overnight shift across local dates but assigns all tips and withholding to its start date', () => {
    const item = shift('2026-01-04T22:00', '2026-01-05T02:00', {
      breaks: [
        { id: 'paid', shift_id: 'shift-a', started_at: iso('2026-01-04T23:30'), ended_at: iso('2026-01-05T00:30'), is_paid: true },
        { id: 'unpaid', shift_id: 'shift-a', started_at: iso('2026-01-05T00:30'), ended_at: iso('2026-01-05T01:00'), is_paid: false },
      ],
      tips: [{ id: 'tip', shift_id: 'shift-a', amount_cents: 1250, label: null, created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-03T00:00:00Z' }],
      tip_tax_withheld_cents: 125,
    })
    const sunday = calculateEarningsReport([item], period('2026-01-04'))
    const monday = calculateEarningsReport([item], period('2026-01-05'))
    expect(sunday.workedMs).toBe(2 * 3_600_000)
    expect(monday.workedMs).toBe(1.5 * 3_600_000)
    expect(sunday.grossWagesCents).toBe(4000)
    expect(monday.grossWagesCents).toBe(3000)
    expect(sunday.totalTipsCents).toBe(1250)
    expect(monday.totalTipsCents).toBe(0)
    expect(sunday.tipTaxWithheldCents).toBe(125)
    expect(monday.tipTaxWithheldCents).toBeNull()
    expect(sunday.earningsAfterTipWithholdingCents).toBe(5125)
    expect(monday.grossEarningsCents).toBe(3000)

    const unpaidCrossingMidnight = shift('2026-01-04T22:00', '2026-01-05T02:00', {
      breaks: [{ id: 'unpaid-crossing', shift_id: 'shift-a', started_at: iso('2026-01-04T23:30'), ended_at: iso('2026-01-05T00:30'), is_paid: false }],
    })
    expect(calculateEarningsReport([unpaidCrossingMidnight], period('2026-01-04')).workedMs).toBe(1.5 * 3_600_000)
    expect(calculateEarningsReport([unpaidCrossingMidnight], period('2026-01-05')).workedMs).toBe(1.5 * 3_600_000)
  })

  it('splits Sunday-to-Monday wages across the correct weekly reports while keeping tips on Sunday', () => {
    const item = shift('2026-10-18T23:00', '2026-10-19T01:00', {
      tips: [{ id: 't', shift_id: 'shift-a', amount_cents: 700, label: 'Cash', created_at: '', updated_at: '' }],
    })
    const sundayWeek = calculateEarningsReport([item], weekPeriod(new Date('2026-10-18T12:00:00-04:00')))
    const mondayWeek = calculateEarningsReport([item], weekPeriod(new Date('2026-10-19T12:00:00-04:00')))
    expect(sundayWeek.grossWagesCents).toBe(2000)
    expect(mondayWeek.grossWagesCents).toBe(2000)
    expect(sundayWeek.totalTipsCents).toBe(700)
    expect(mondayWeek.totalTipsCents).toBe(0)
  })

  it('keeps month-end and year-end shift wages on the dates they are earned', () => {
    const item = shift('2026-12-31T23:00', '2027-01-01T01:00')
    const december = calculateEarningsReport([item], period('2026-12-01', '2026-12-31'))
    const january = calculateEarningsReport([item], period('2027-01-01', '2027-01-31'))
    expect(december.workedMs).toBe(3_600_000)
    expect(january.workedMs).toBe(3_600_000)
    expect(december.grossWagesCents).toBe(2000)
    expect(january.grossWagesCents).toBe(2000)
  })

  it('handles spring-forward and fall-back shifts using actual elapsed timestamps', () => {
    const spring = shift('2026-03-08T00:00', '2026-03-08T04:00', {
      breaks: [{ id: 'u', shift_id: 'shift-a', started_at: iso('2026-03-08T00:30'), ended_at: iso('2026-03-08T01:00'), is_paid: false }],
    })
    const springReport = calculateEarningsReport([spring], period('2026-03-08'))
    expect(springReport.workedMs).toBe(2.5 * 3_600_000)
    expect(springReport.grossWagesCents).toBe(5000)

    const fall = shift('2026-11-01T00:00', '2026-11-01T04:00', {
      started_at: '2026-11-01T04:00:00.000Z', ended_at: '2026-11-01T09:00:00.000Z',
    })
    const fallReport = calculateEarningsReport([fall], period('2026-11-01'))
    expect(fallReport.workedMs).toBe(5 * 3_600_000)
    expect(fallReport.grossWagesCents).toBe(10000)
  })

  it('reconciles cent allocation over a midnight split to the existing full-shift rounded wage', () => {
    const item = shift('2026-10-21T23:59:59.000', '2026-10-22T00:00:01.000', { hourly_wage_cents_snapshot: 1850 })
    const full = calculateShiftEarnings(item, Date.now()).grossWagesCents
    const firstDay = calculateEarningsReport([item], period('2026-10-21')).grossWagesCents ?? 0
    const secondDay = calculateEarningsReport([item], period('2026-10-22')).grossWagesCents ?? 0
    expect(firstDay + secondDay).toBe(full)
    expect(firstDay).toBe(1)
    const zeroCentDay = calculateEarningsReport([item], period('2026-10-22'))
    expect(zeroCentDay.knownGrossWagesCents).toBe(0)
    expect(zeroCentDay.knownWageShiftCount).toBe(1)
    expect(zeroCentDay.missingWageShiftCount).toBe(0)
  })

  it('places edited tips by shift start date and reports the saved profile breakdown', () => {
    const oldCreatedTip = shift('2026-10-20T23:30', '2026-10-21T01:30', {
      wage_profile_name_snapshot: 'Night shift',
      tips: [{ id: 'tip', shift_id: 'shift-a', amount_cents: 5555, label: 'Card', created_at: '2026-10-25T12:00:00Z', updated_at: '2026-10-25T12:30:00Z' }],
      tip_tax_withheld_cents: 55,
    })
    const startDateReport = calculateEarningsReport([oldCreatedTip], period('2026-10-20'))
    const editDateReport = calculateEarningsReport([oldCreatedTip], period('2026-10-25'))
    expect(startDateReport.totalTipsCents).toBe(5555)
    expect(startDateReport.tipTaxWithheldCents).toBe(55)
    expect(startDateReport.wageProfiles[0]).toMatchObject({ name: 'Night shift', workedMs: 30 * 60_000, wagesCents: 1000 })
    expect(editDateReport.totalTipsCents).toBe(0)
    expect(editDateReport.tipTaxWithheldCents).toBeNull()
  })

  it('preserves known subtotals when one or more legacy shifts lack wage snapshots', () => {
    const unknown = shift('2026-10-21T09:00', '2026-10-21T10:00', { hourly_wage_cents_snapshot: null, wage_profile_name_snapshot: null })
    const known = shift('2026-10-21T10:00', '2026-10-21T11:00', {
      id: 'known', hourly_wage_cents_snapshot: 1800,
      tips: [{ id: 't', shift_id: 'known', amount_cents: 2500, label: 'Cash', created_at: '', updated_at: '' }],
      tip_tax_withheld_cents: 300,
    })
    const oneMissing = calculateEarningsReport([known, unknown], period('2026-10-21'))
    expect(oneMissing.workedMs).toBe(7_200_000)
    expect(oneMissing.grossWagesCents).toBeNull()
    expect(oneMissing.knownGrossWagesCents).toBe(1800)
    expect(oneMissing.knownWageShiftCount).toBe(1)
    expect(oneMissing.missingWageShiftCount).toBe(1)
    expect(oneMissing.totalTipsCents).toBe(2500)
    expect(oneMissing.tipTaxWithheldCents).toBe(300)
    expect(oneMissing.grossEarningsCents).toBeNull()
    expect(oneMissing.knownGrossEarningsCents).toBe(4300)
    expect(oneMissing.earningsAfterTipWithholdingCents).toBeNull()
    expect(oneMissing.knownEarningsAfterTipWithholdingCents).toBe(4000)
    expect(oneMissing.wageProfiles.find((item) => item.name === 'Day shift')).toMatchObject({ knownWagesCents: 1800, knownWageShiftCount: 1, missingWageShiftCount: 0 })
    expect(oneMissing.wageProfiles.find((item) => item.name === 'No profile recorded')).toMatchObject({ wagesCents: null, knownWagesCents: 0, missingWageShiftCount: 1 })

    const secondUnknown = { ...unknown, id: 'unknown-b', started_at: iso('2026-10-21T11:00'), ended_at: iso('2026-10-21T12:00') }
    const multipleMissing = calculateEarningsReport([known, unknown, secondUnknown], period('2026-10-21'))
    expect(multipleMissing.missingWageShiftCount).toBe(2)
    expect(multipleMissing.knownGrossWagesCents).toBe(1800)

    const everyMissing = calculateEarningsReport([unknown, secondUnknown], period('2026-10-21'))
    expect(everyMissing.grossWagesCents).toBeNull()
    expect(everyMissing.knownGrossWagesCents).toBe(0)
    expect(everyMissing.knownWageShiftCount).toBe(0)
    expect(everyMissing.missingWageShiftCount).toBe(2)
    expect(calculateEarningsReport([], period('2026-10-21')).shiftCount).toBe(0)
  })

  it('keeps tips visible for a tip-only legacy shift without claiming wages are zero', () => {
    const item = shift('2026-10-21T09:00', '2026-10-21T10:00', {
      hourly_wage_cents_snapshot: null,
      breaks: [{ id: 'unpaid-all', shift_id: 'shift-a', started_at: iso('2026-10-21T09:00'), ended_at: iso('2026-10-21T10:00'), is_paid: false }],
      tips: [{ id: 'tip', shift_id: 'shift-a', amount_cents: 1200, label: 'Card', created_at: '', updated_at: '' }],
    })
    const report = calculateEarningsReport([item], period('2026-10-21'))
    expect(report.workedMs).toBe(0)
    expect(report.missingWageShiftCount).toBe(0)
    expect(report.knownGrossWagesCents).toBe(0)
    expect(report.totalTipsCents).toBe(1200)
    expect(report.knownEarningsAfterTipWithholdingCents).toBe(1200)
  })
})
