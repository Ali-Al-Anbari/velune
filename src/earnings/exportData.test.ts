import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShiftRecord } from '../shift/time'
import { calculateEarningsReport } from './reports'
import { createEarningsCsv, DETAIL_COLUMNS, formatLocalDateTime, formatWorkedDuration, getExportDetailRows, getExportTotals } from './exportData'
import { createEarningsWorkbook } from './xlsxExport'

const period = { startDate: '2026-10-19', endDate: '2026-10-25' }
const runtime = globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }
const env = runtime.process?.env
let originalTimezone: string | undefined

function shift(id: string, startedAt: string, endedAt: string, extra: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id, user_id: 'user-a', started_at: startedAt, ended_at: endedAt, breaks: [], tips: [],
    hourly_wage_cents_snapshot: 1850, wage_profile_name_snapshot: 'Day shift', wage_profile_id: 'profile-a', ...extra,
  }
}

beforeEach(() => {
  if (!env) throw new Error('Node test environment is required for local timezone export tests.')
  originalTimezone = env.TZ
  env.TZ = 'America/New_York'
})
afterEach(() => {
  if (!env) return
  if (originalTimezone === undefined) delete env.TZ
  else env.TZ = originalTimezone
})

describe('earnings export formatting', () => {
  it('formats worked milliseconds as rounded hours and minutes', () => {
    expect(formatWorkedDuration(6 * 3_600_000 + 16 * 60_000)).toBe('6h 16m')
    expect(formatWorkedDuration(5 * 3_600_000 + 60_000)).toBe('5h 01m')
    expect(formatWorkedDuration(5 * 3_600_000)).toBe('5h 00m')
    expect(formatWorkedDuration(9 * 3_600_000 + 23 * 60_000)).toBe('9h 23m')
    expect(formatWorkedDuration(59_000)).toBe('0h 01m')
  })

  it('formats dates and times in the local reporting timezone, including overnight end dates', () => {
    expect(formatLocalDateTime('2026-10-21T03:00:00Z', '2026-10-21T07:00:00Z')).toEqual({
      date: 'Oct 20, 2026', start: '11:00 PM', end: 'Oct 21, 2026 at 3:00 AM',
    })
    expect(formatLocalDateTime('2026-10-21T13:00:00Z', '2026-10-21T21:00:00Z')).toEqual({
      date: 'Oct 21, 2026', start: '9:00 AM', end: '5:00 PM',
    })
  })

  it('preserves distinct shifts and reconciles wages, tips, and withholding', () => {
    const report = calculateEarningsReport([
      shift('overnight', '2026-10-21T03:00:00Z', '2026-10-21T07:00:00Z', {
        breaks: [
          { id: 'paid', shift_id: 'overnight', started_at: '2026-10-21T04:00:00Z', ended_at: '2026-10-21T04:30:00Z', is_paid: true },
          { id: 'unpaid', shift_id: 'overnight', started_at: '2026-10-21T04:30:00Z', ended_at: '2026-10-21T05:00:00Z', is_paid: false },
        ],
        tips: [{ id: 'tip', shift_id: 'overnight', amount_cents: 333, label: 'Cash', created_at: '', updated_at: '' }],
        tip_tax_withheld_cents: 33,
      }),
      shift('same-date-2', '2026-10-21T02:00:00Z', '2026-10-21T03:00:00Z'),
    ], period)
    const rows = getExportDetailRows(report)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ date: 'Oct 20, 2026', start: '11:00 PM', end: 'Oct 21, 2026 at 3:00 AM', worked: '3h 30m' })
    expect(rows[1]?.wagesCents).toBe(report.grossWagesCents! - 1850)
    expect(rows[1]?.tipsCents).toBe(333)
    expect(rows[1]?.taxWithheldCents).toBe(33)
    expect(rows[1]?.totalCents).toBe(rows[1]!.wagesCents! + 333 - 33)
    expect(rows[1]?.date).toBe(rows[0]?.date)
    expect(getExportTotals(report)).toMatchObject({
      worked: '4h 30m', wagesCents: report.grossWagesCents, tipsCents: report.totalTipsCents,
      taxWithheldCents: report.tipTaxWithheldCents, totalCents: report.earningsAfterTipWithholdingCents,
    })
  })

  it('allocates cross-period work while assigning tips and withholding to the shift start date', () => {
    const overnight = shift('boundary', '2026-10-21T03:00:00Z', '2026-10-21T05:00:00Z', {
      tips: [{ id: 'tip', shift_id: 'boundary', amount_cents: 777, label: null, created_at: '', updated_at: '' }],
      tip_tax_withheld_cents: 77,
    })
    const startDate = calculateEarningsReport([overnight], { startDate: '2026-10-20', endDate: '2026-10-20' })
    const nextDate = calculateEarningsReport([overnight], { startDate: '2026-10-21', endDate: '2026-10-21' })
    expect(getExportDetailRows(startDate)[0]).toMatchObject({ worked: '1h 00m', tipsCents: 777, taxWithheldCents: 77 })
    expect(getExportDetailRows(nextDate)[0]).toMatchObject({ worked: '1h 00m', tipsCents: 0, taxWithheldCents: null })
    expect(startDate.shiftAllocations[0]?.grossWagesCents).toBe(1850)
    expect(nextDate.shiftAllocations[0]?.grossWagesCents).toBe(1850)
  })

  it('keeps unknown wages and blank versus zero withholding distinct in CSV', () => {
    const unknown = shift('unknown', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z', {
      hourly_wage_cents_snapshot: null, wage_profile_name_snapshot: '=HYPERLINK("https://bad")',
      tips: [{ id: 't', shift_id: 'unknown', amount_cents: 50, label: 'Cash', created_at: '', updated_at: '' }],
      tip_tax_withheld_cents: null,
    })
    const explicitZero = shift('zero', '2026-10-21T13:00:00Z', '2026-10-21T14:00:00Z', { tip_tax_withheld_cents: 0 })
    const report = calculateEarningsReport([unknown, explicitZero], period)
    const rows = getExportDetailRows(report)
    expect(rows[0]).toMatchObject({ wagesCents: null, totalCents: null, taxWithheldCents: null, tipsCents: 50 })
    expect(rows[1]?.taxWithheldCents).toBe(0)
    const moneySheet = createEarningsWorkbook(report).getWorksheet('Shifts')
    expect(moneySheet?.getRow(2).getCell(9).value).toBeNull()
    expect(moneySheet?.getRow(3).getCell(9).value).toBe(0)
    const csv = createEarningsCsv(report)
    expect(csv).toContain("'=HYPERLINK(")
    expect(csv).toContain('"0.50"')
    expect(csv).toContain('"0.00"')
    expect(csv.split('\r\n').at(-1)).toBe('"Totals",,,,"2h 00m",,,"0.50","0.00",')
  })

  it('quotes CSV fields and writes the requested columns followed by a totals row', () => {
    const report = calculateEarningsReport([shift('id', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z', {
      wage_profile_name_snapshot: 'Night, "A"',
    })], period)
    const lines = createEarningsCsv(report).replace(/^\uFEFF/, '').split('\r\n')
    expect(lines[0]?.split(',').map((cell) => cell.replaceAll('"', ''))).toEqual([...DETAIL_COLUMNS])
    expect(lines[1]).toContain('"Night, ""A"""')
    expect(lines[2]?.startsWith('"Totals"')).toBe(true)
    expect(createEarningsCsv(calculateEarningsReport([], period)).split('\r\n')).toHaveLength(2)
  })

  it('creates one plain Shifts worksheet with every shift and numeric currency totals', async () => {
    const report = calculateEarningsReport([
      shift('first', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z', {
        tips: [{ id: 'tip', shift_id: 'first', amount_cents: 333, label: null, created_at: '', updated_at: '' }],
        tip_tax_withheld_cents: 33,
      }),
      shift('second', '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'),
      shift('third', '2026-10-20T17:00:00Z', '2026-10-20T18:00:00Z'),
      shift('unknown', '2026-10-21T13:00:00Z', '2026-10-21T14:00:00Z', { hourly_wage_cents_snapshot: null }),
    ], period)
    const workbook = createEarningsWorkbook(report)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Shifts'])
    const sheet = workbook.getWorksheet('Shifts')
    expect(sheet?.getRow(1).values).toEqual([undefined, ...DETAIL_COLUMNS])
    expect(sheet?.getRow(2).getCell(5).value).toBe('1h 00m')
    expect(sheet?.getRow(2).getCell(6).value).toBe(18.5)
    expect(sheet?.getRow(2).getCell(6).numFmt).toContain('0.00')
    expect(sheet?.getRow(2).getCell(8).value).toBe(3.33)
    expect(sheet?.getRow(2).getCell(9).value).toBe(0.33)
    expect(sheet?.getRow(2).getCell(10).value).toBe(21.5)
    expect(sheet?.getRow(2).getCell(1).value).toBe('Oct 20, 2026')
    expect(sheet?.getRow(3).getCell(1).value).toBe('Oct 20, 2026')
    expect(sheet?.getRow(4).getCell(1).value).toBe('Oct 20, 2026')
    expect(sheet?.getRow(5).getCell(7).value).toBeNull()
    expect(sheet?.getRow(6).getCell(1).value).toBe('Totals')
    expect(sheet?.getRow(6).getCell(5).value).toBe('4h 00m')
    expect(sheet?.getRow(6).getCell(7).value).toBeNull()
    expect(sheet?.getRow(6).getCell(8).value).toBe(3.33)
    expect(sheet?.getRow(6).getCell(9).value).toBe(0.33)
    expect(sheet?.getRow(6).getCell(10).value).toBeNull()
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(sheet?.getRow(1).getCell(1).font.color?.argb).toBe('202124')
    expect(sheet?.getRow(1).getCell(1).fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'F1F3F4' } })
    expect(workbook.getWorksheet('SUMMARY')).toBeUndefined()
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000)

    const complete = calculateEarningsReport([shift('complete', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z', {
      tips: [{ id: 'tip', shift_id: 'complete', amount_cents: 333, label: null, created_at: '', updated_at: '' }],
      tip_tax_withheld_cents: 33,
    })], period)
    const completeTotals = createEarningsWorkbook(complete).getWorksheet('Shifts')?.getRow(3)
    expect(completeTotals?.getCell(7).value).toBe(18.5)
    expect(completeTotals?.getCell(8).value).toBe(3.33)
    expect(completeTotals?.getCell(9).value).toBe(0.33)
    expect(completeTotals?.getCell(10).value).toBe(21.5)
  })
})
