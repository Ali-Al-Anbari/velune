export type BreakRecord = {
  id: string
  shift_id: string
  started_at: string
  ended_at: string | null
  is_paid: boolean
}

export type ShiftRecord = {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  breaks: BreakRecord[]
  tips?: import('../earnings/api').Tip[]
  tip_tax_withheld_cents?: number | null
  wage_profile_id?: string | null
  wage_profile_name_snapshot?: string | null
  hourly_wage_cents_snapshot?: number | null
  hourly_wage_override_cents?: number | null
  normally_tipped_snapshot?: boolean | null
  /** Legacy profile snapshots retained for compatibility; no tip tax estimate uses these. */
  include_tips_in_tax_estimate_snapshot?: boolean | null
  estimated_withholding_bps_snapshot?: number | null
}

export type ShiftTotals = {
  elapsedMs: number
  paidBreakMs: number
  unpaidBreakMs: number
  workedMs: number
}

function instant(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('A saved timestamp could not be read.')
  return parsed
}

export function shiftTotals(shift: ShiftRecord, nowMs: number): ShiftTotals {
  const start = instant(shift.started_at)
  const end = shift.ended_at ? instant(shift.ended_at) : nowMs
  const elapsedMs = Math.max(0, end - start)
  let paidBreakMs = 0
  let unpaidBreakMs = 0

  for (const item of shift.breaks) {
    const breakStart = instant(item.started_at)
    const breakEnd = item.ended_at ? instant(item.ended_at) : end
    const duration = Math.max(0, Math.min(end, breakEnd) - Math.max(start, breakStart))
    if (item.is_paid) paidBreakMs += duration
    else unpaidBreakMs += duration
  }

  return {
    elapsedMs,
    paidBreakMs,
    unpaidBreakMs,
    workedMs: Math.max(0, elapsedMs - unpaidBreakMs),
  }
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
