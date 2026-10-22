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
  manual_edit_version?: number
}

const manualShiftMaximumMs = 24 * 60 * 60 * 1000

export function localDateTimeInput(timestamp: string) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('A saved timestamp could not be read.')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseLocalDateTimeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid local date and time.')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || localDateTimeInput(date.toISOString()) !== value) {
    throw new Error('That local time does not exist because of a clock change. Choose another time.')
  }
  return date.toISOString()
}

export function validateManualShiftRange(startedAt: string, endedAt: string, nowMs = Date.now()) {
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Enter valid start and end times.')
  if (start >= end) throw new Error('Shift start must be earlier than shift end.')
  if (end > nowMs) throw new Error('Manual shifts must end in the past.')
  if (end - start > manualShiftMaximumMs) throw new Error('A shift cannot be longer than 24 hours.')
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
