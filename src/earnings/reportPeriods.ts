export type ReportPeriod = { startDate: string; endDate: string }
export type PeriodMode = 'week' | 'month' | 'custom'

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Enter a valid date.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Enter a valid date.')
  return date
}

export function localDateKey(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value)
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function dateKeyOffset(value: string, days: number) {
  const date = parseDateKey(value)
  return dateKeyOffsetFromParts(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dateKeyOffsetFromParts(year: number, zeroBasedMonth: number, day: number) {
  const date = new Date(year, zeroBasedMonth, day)
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function reportPeriodBounds(period: ReportPeriod) {
  const start = parseDateKey(period.startDate)
  const end = parseDateKey(period.endDate)
  if (period.startDate > period.endDate) throw new Error('The start date must be on or before the end date.')
  const startAt = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
  return { startAt, endExclusive }
}

export function weekPeriod(value: Date | number = Date.now()): ReportPeriod {
  const date = value instanceof Date ? value : new Date(value)
  const daysSinceMonday = (date.getDay() + 6) % 7
  const startDate = dateKeyOffset(localDateKey(date), -daysSinceMonday)
  return { startDate, endDate: dateKeyOffset(startDate, 6) }
}

export function monthPeriod(value: Date | number = Date.now()): ReportPeriod {
  const date = value instanceof Date ? value : new Date(value)
  const startDate = dateKey(date.getFullYear(), date.getMonth() + 1, 1)
  return { startDate, endDate: dateKey(date.getFullYear(), date.getMonth() + 1, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) }
}

export function moveReportPeriod(period: ReportPeriod, mode: PeriodMode, direction: -1 | 1): ReportPeriod {
  if (mode === 'week') {
    const startDate = dateKeyOffset(period.startDate, 7 * direction)
    return { startDate, endDate: dateKeyOffset(startDate, 6) }
  }
  if (mode === 'month') {
    const date = parseDateKey(period.startDate)
    const targetMonth = new Date(date.getFullYear(), date.getMonth() + direction, 1)
    return monthPeriod(targetMonth)
  }
  const length = Math.round((parseDateKey(period.endDate).getTime() - parseDateKey(period.startDate).getTime()) / 86_400_000) + 1
  const startDate = dateKeyOffset(period.startDate, length * direction)
  return { startDate, endDate: dateKeyOffset(startDate, length - 1) }
}

export function periodContainsToday(period: ReportPeriod, now: Date | number = Date.now()) {
  const today = localDateKey(now)
  return period.startDate <= today && period.endDate >= today
}

export function formatReportPeriod(period: ReportPeriod) {
  const start = parseDateKey(period.startDate)
  const end = parseDateKey(period.endDate)
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  const formatter = new Intl.DateTimeFormat(undefined, options)
  if (period.startDate === period.endDate) return formatter.format(start)
  if (start.getFullYear() === end.getFullYear()) {
    const left = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(start)
    const right = new Intl.DateTimeFormat(undefined, options).format(end)
    return `${left} – ${right}`
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`
}
