import type { EarningsReport } from './reports'

export const DETAIL_COLUMNS = [
  'Date', 'Start', 'End', 'Profile', 'Worked', 'Hourly', 'Wages', 'Tips', 'Tax Withheld', 'Total',
] as const

export type ExportDetailRow = {
  date: string
  start: string
  end: string
  profile: string
  worked: string
  hourlyCents: number | null
  wagesCents: number | null
  tipsCents: number
  taxWithheldCents: number | null
  totalCents: number | null
}

export function formatWorkedDuration(workedMs: number): string {
  const minutes = Math.max(0, Math.round(workedMs / 60_000))
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function parsedDate(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export function formatLocalDateTime(startedAt: string, endedAt: string | null) {
  const start = parsedDate(startedAt)
  const end = endedAt ? parsedDate(endedAt) : null
  if (!start) return { date: startedAt, start: '', end: '' }
  const dateFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const date = dateFormatter.format(start)
  const startTime = timeFormatter.format(start)
  if (!end) return { date, start: startTime, end: '' }
  const startDay = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`
  const endDay = `${end.getFullYear()}-${end.getMonth()}-${end.getDate()}`
  const endTime = timeFormatter.format(end)
  return { date, start: startTime, end: startDay === endDay ? endTime : `${dateFormatter.format(end)} at ${endTime}` }
}

export function getExportDetailRows(report: EarningsReport): ExportDetailRow[] {
  return report.shiftAllocations.map((row) => ({
    ...formatLocalDateTime(row.startedAt, row.endedAt),
    profile: row.wageProfileName,
    worked: formatWorkedDuration(row.workedMs),
    hourlyCents: row.hourlyRateCents,
    wagesCents: row.grossWagesCents,
    tipsCents: row.totalTipsCents,
    taxWithheldCents: row.tipTaxWithheldCents,
    totalCents: row.earningsAfterTipWithholdingCents,
  }))
}

export function getExportTotals(report: EarningsReport): ExportDetailRow {
  const displayedWorkedMs = report.shiftAllocations.reduce((total, row) => total + Math.round(row.workedMs / 60_000) * 60_000, 0)
  return {
    date: 'Totals', start: '', end: '', profile: '',
    worked: formatWorkedDuration(displayedWorkedMs),
    hourlyCents: null,
    wagesCents: report.grossWagesCents,
    tipsCents: report.totalTipsCents,
    taxWithheldCents: report.tipTaxWithheldCents,
    totalCents: report.earningsAfterTipWithholdingCents,
  }
}

function safeText(value: string): string {
  let first = 0
  while (first < value.length) {
    const code = value.charCodeAt(first)
    if (code > 0x20 && code !== 0x7f && code !== 0xfeff && (code < 0x200b || code > 0x200f) && (code < 0x202a || code > 0x202e) && code !== 0x2060) break
    first += 1
  }
  return /^[=+\-@]/.test(value.slice(first, first + 1)) ? `'${value}` : value
}

export function centsText(cents: number | null): string {
  if (cents === null) return ''
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

type CsvCellValue = { kind: 'text'; value: string } | { kind: 'money'; cents: number | null }
const textCell = (value: string): CsvCellValue => ({ kind: 'text', value })
const moneyCell = (cents: number | null): CsvCellValue => ({ kind: 'money', cents })

function csvCell(cell: CsvCellValue): string {
  const value = cell.kind === 'money' ? centsText(cell.cents) : safeText(cell.value)
  if (value === '') return ''
  return `"${value.replaceAll('"', '""')}"`
}

function csvRow(row: ExportDetailRow): CsvCellValue[] {
  return [textCell(row.date), textCell(row.start), textCell(row.end), textCell(row.profile), textCell(row.worked),
    moneyCell(row.hourlyCents), moneyCell(row.wagesCents), moneyCell(row.tipsCents),
    moneyCell(row.taxWithheldCents), moneyCell(row.totalCents)]
}

export function createEarningsCsv(report: EarningsReport): string {
  const rows = [...getExportDetailRows(report), getExportTotals(report)].map(csvRow)
  const header = DETAIL_COLUMNS.map((value) => textCell(value))
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}
