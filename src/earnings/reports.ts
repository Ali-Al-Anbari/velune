import { calculateShiftEarnings } from './shiftEarnings'
import { localDateKey, reportPeriodBounds, type ReportPeriod } from './reportPeriods'
import { shiftTotals, type ShiftRecord } from '../shift/time'

type Interval = { start: number; end: number }
export type WageProfileReport = {
  key: string
  name: string
  workedMs: number
  /** Complete profile total, null when any contributing shift lacks a wage snapshot. */
  wagesCents: number | null
  knownWagesCents: number
  knownWageShiftCount: number
  missingWageShiftCount: number
  totalTipsCents: number
  tipTaxWithheldCents: number | null
  grossEarningsCents: number | null
  knownGrossEarningsCents: number
  earningsAfterTipWithholdingCents: number | null
  knownEarningsAfterTipWithholdingCents: number
}
export type EarningsReport = {
  shiftCount: number
  workedMs: number
  grossWagesCents: number | null
  knownGrossWagesCents: number
  knownWageShiftCount: number
  missingWageShiftCount: number
  totalTipsCents: number
  tipTaxWithheldCents: number | null
  grossEarningsCents: number | null
  knownGrossEarningsCents: number
  earningsAfterTipWithholdingCents: number | null
  knownEarningsAfterTipWithholdingCents: number
  wageProfiles: WageProfileReport[]
}

function workedIntervals(shift: ShiftRecord, nowMs: number): Interval[] {
  const start = Date.parse(shift.started_at)
  const end = shift.ended_at ? Date.parse(shift.ended_at) : nowMs
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const unpaid = shift.breaks
    .filter((item) => !item.is_paid)
    .map((item) => ({ start: Math.max(start, Date.parse(item.started_at)), end: Math.min(end, item.ended_at ? Date.parse(item.ended_at) : end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start)
  const result: Interval[] = []
  let cursor = start
  for (const pause of unpaid) {
    if (pause.start > cursor) result.push({ start: cursor, end: pause.start })
    cursor = Math.max(cursor, pause.end)
  }
  if (cursor < end) result.push({ start: cursor, end })
  return result
}

function dailyWorkedMilliseconds(shift: ShiftRecord, nowMs: number) {
  const daily = new Map<string, number>()
  for (const interval of workedIntervals(shift, nowMs)) {
    let cursor = interval.start
    while (cursor < interval.end) {
      const at = new Date(cursor)
      const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime()
      const next = Math.min(interval.end, midnight)
      const day = localDateKey(cursor)
      daily.set(day, (daily.get(day) ?? 0) + next - cursor)
      cursor = next
    }
  }
  return daily
}

/** Split the already-rounded full-shift wage total across local dates without losing or creating cents. */
function allocateCents(totalCents: number, daily: Map<string, number>) {
  const totalMs = [...daily.values()].reduce((sum, value) => sum + value, 0)
  if (totalMs <= 0 || totalCents === 0) return new Map([...daily.keys()].map((day) => [day, 0]))
  const total = BigInt(totalCents)
  const denominator = BigInt(totalMs)
  const remainders: { day: string; remainder: bigint }[] = []
  const allocated = new Map<string, number>()
  let assigned = 0
  for (const [day, milliseconds] of daily) {
    const numerator = total * BigInt(milliseconds)
    const base = numerator / denominator
    allocated.set(day, Number(base))
    assigned += Number(base)
    remainders.push({ day, remainder: numerator % denominator })
  }
  remainders.sort((left, right) => left.remainder === right.remainder ? left.day.localeCompare(right.day) : left.remainder > right.remainder ? -1 : 1)
  for (let index = 0; index < totalCents - assigned; index += 1) {
    const entry = remainders[index]
    if (entry) allocated.set(entry.day, (allocated.get(entry.day) ?? 0) + 1)
  }
  return allocated
}

export function calculateEarningsReport(shifts: ShiftRecord[], period: ReportPeriod, nowMs = Date.now()): EarningsReport {
  const { startAt, endExclusive } = reportPeriodBounds(period)
  const startMs = startAt.getTime()
  const endMs = endExclusive.getTime()
  let workedMs = 0
  let totalTipsCents = 0
  let enteredWithholdingCents = 0
  let hasEnteredWithholding = false
  let wageAllocationValid = true
  let knownGrossWagesCents = 0
  let knownWageShiftCount = 0
  let missingWageShiftCount = 0
  let relevantShiftCount = 0
  const profileMap = new Map<string, WageProfileReport>()

  for (const original of shifts) {
    const shift: ShiftRecord = { ...original, tips: original.tips ?? [], breaks: original.breaks ?? [] }
    const start = Date.parse(shift.started_at)
    const effectiveEnd = shift.ended_at ? Date.parse(shift.ended_at) : nowMs
    if (!Number.isFinite(start) || !Number.isFinite(effectiveEnd)) continue
    const startDay = localDateKey(start)
    const startsInPeriod = startDay >= period.startDate && startDay <= period.endDate
    const overlapsPeriod = start < endMs && effectiveEnd > startMs
    if (!startsInPeriod && !overlapsPeriod) continue
    relevantShiftCount += 1

    const earnings = calculateShiftEarnings(shift, nowMs)
    if (startsInPeriod) {
      totalTipsCents += earnings.totalTipsCents ?? 0
      if (earnings.tipTaxWithheldCents !== null) {
        hasEnteredWithholding = true
        enteredWithholdingCents += earnings.tipTaxWithheldCents
      }
    }

    const daily = dailyWorkedMilliseconds(shift, nowMs)
    const fullShiftWorkedMs = shiftTotals(shift, nowMs).workedMs
    const allocatedWages = earnings.grossWagesCents === null ? null : allocateCents(earnings.grossWagesCents, daily)
    if ([...daily.values()].reduce((sum, value) => sum + value, 0) !== fullShiftWorkedMs) wageAllocationValid = false
    const periodDays = [...daily].filter(([day, duration]) => duration > 0 && day >= period.startDate && day <= period.endDate)
    // Group by the saved profile ID. The name is the shift snapshot, never a live profile lookup.
    const savedProfileName = shift.wage_profile_name_snapshot?.trim() ?? ''
    const profileKey = shift.wage_profile_id ? `id:${shift.wage_profile_id}:${savedProfileName}` : savedProfileName ? `snapshot:${savedProfileName}` : 'no-profile'
    const profileName = shift.wage_profile_id || savedProfileName ? savedProfileName || 'Wage profile' : 'No profile'
    const profile = profileMap.get(profileKey) ?? {
      key: profileKey, name: profileName, workedMs: 0, wagesCents: 0, knownWagesCents: 0,
      knownWageShiftCount: 0, missingWageShiftCount: 0, totalTipsCents: 0,
      tipTaxWithheldCents: null, grossEarningsCents: 0, knownGrossEarningsCents: 0,
      earningsAfterTipWithholdingCents: 0, knownEarningsAfterTipWithholdingCents: 0,
    }
    if (startsInPeriod) {
      profile.totalTipsCents += earnings.totalTipsCents ?? 0
      if (earnings.tipTaxWithheldCents !== null) {
        profile.tipTaxWithheldCents = (profile.tipTaxWithheldCents ?? 0) + earnings.tipTaxWithheldCents
      }
    }
    if (periodDays.length > 0) {
      if (allocatedWages === null) {
        missingWageShiftCount += 1
        profile.missingWageShiftCount += 1
        profile.wagesCents = null
      } else {
        knownWageShiftCount += 1
        profile.knownWageShiftCount += 1
      }
    }

    for (const [day, duration] of daily) {
      if (day < period.startDate || day > period.endDate) continue
      workedMs += duration
      profile.workedMs += duration
      if (allocatedWages !== null) {
        const dailyWages = allocatedWages.get(day) ?? 0
        knownGrossWagesCents += dailyWages
        profile.knownWagesCents += dailyWages
        if (profile.wagesCents !== null) profile.wagesCents += dailyWages
      }
    }
    if (periodDays.length > 0 || startsInPeriod) profileMap.set(profileKey, profile)
  }

  const wagesComplete = missingWageShiftCount === 0 && wageAllocationValid
  const grossWagesCents = wagesComplete ? knownGrossWagesCents : null
  const grossEarningsCents = grossWagesCents === null ? null : grossWagesCents + totalTipsCents
  const knownGrossEarningsCents = knownGrossWagesCents + totalTipsCents
  const tipTaxWithheldCents = hasEnteredWithholding ? enteredWithholdingCents : null
  const wageProfiles = [...profileMap.values()].map((profile) => {
    const complete = profile.missingWageShiftCount === 0 && wageAllocationValid
    const knownGrossEarningsCents = profile.knownWagesCents + profile.totalTipsCents
    const withheld = profile.tipTaxWithheldCents ?? 0
    return {
      ...profile,
      grossEarningsCents: complete ? knownGrossEarningsCents : null,
      knownGrossEarningsCents,
      earningsAfterTipWithholdingCents: complete ? knownGrossEarningsCents - withheld : null,
      knownEarningsAfterTipWithholdingCents: knownGrossEarningsCents - withheld,
    }
  }).sort((left, right) => right.workedMs - left.workedMs || left.name.localeCompare(right.name))
  return {
    shiftCount: relevantShiftCount,
    workedMs,
    grossWagesCents,
    knownGrossWagesCents,
    knownWageShiftCount,
    missingWageShiftCount,
    totalTipsCents,
    tipTaxWithheldCents,
    grossEarningsCents,
    knownGrossEarningsCents,
    earningsAfterTipWithholdingCents: grossEarningsCents === null ? null : grossEarningsCents - (tipTaxWithheldCents ?? 0),
    knownEarningsAfterTipWithholdingCents: knownGrossEarningsCents - (tipTaxWithheldCents ?? 0),
    wageProfiles,
  }
}
