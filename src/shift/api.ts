import { supabase } from '../lib/supabase'
import type { ShiftRecord } from './time'
import { deleteAllShiftAttachments } from './attachments'

const pageSize = 20
const recentShiftLimit = 3
const fields = 'id, user_id, started_at, ended_at, wage_profile_id, wage_profile_name_snapshot, hourly_wage_cents_snapshot, hourly_wage_override_cents, normally_tipped_snapshot, include_tips_in_tax_estimate_snapshot, estimated_withholding_bps_snapshot, tip_tax_withheld_cents, manual_edit_version, breaks(id, shift_id, started_at, ended_at, is_paid), tips(id, shift_id, amount_cents, label, created_at, updated_at), attachments:shift_attachments(id, user_id, shift_id, storage_path, original_filename, mime_type, file_size_bytes, created_at)'

export type ShiftHistoryFilters = {
  search?: string
  startDate?: string
  endDate?: string
  wageProfileId?: string
  withTipsOnly?: boolean
  missingWageOnly?: boolean
  sort?: 'newest' | 'oldest' | 'longest' | 'most-tips' | 'highest-rate'
}
export type ShiftHistoryCursor = { startedAt: string; id: string; sortValue?: number | string | null }

export type ManualBreakInput = { id: string; started_at: string; ended_at: string; is_paid: boolean }
export type ManualShiftInput = {
  started_at: string
  ended_at: string
  wage_profile_id: string | null
  hourly_wage_override_cents: number | null
  breaks: ManualBreakInput[]
}

function client() {
  if (!supabase) throw new Error('Supabase is unavailable.')
  return supabase
}

function asShift(row: unknown): ShiftRecord {
  const shift = row as ShiftRecord
  return {
    ...shift,
    breaks: [...(shift.breaks ?? [])].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)),
    tips: [...(shift.tips ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    attachments: [...(shift.attachments ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
  }
}

export async function loadShiftPage(userId: string, offset = 0) {
  const query = client().from('shifts').select(fields)
    .eq('user_id', userId).not('ended_at', 'is', null)
    .order('started_at', { ascending: false }).range(offset, offset + pageSize)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []).map(asShift)
  return { shifts: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}

function localDateStart(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (value.getFullYear() !== Number(match[1]) || value.getMonth() !== Number(match[2]) - 1 || value.getDate() !== Number(match[3])) return null
  return value
}

function nextLocalDay(value: Date) {
  const next = new Date(value)
  next.setDate(next.getDate() + 1)
  return next
}

/** Query one RLS-protected history page after applying filters on the complete owner-scoped dataset. */
export async function loadShiftHistoryPage(userId: string, cursor: ShiftHistoryCursor | null, filters: ShiftHistoryFilters = {}) {
  let startedAt: string | null = null
  let endedBefore: string | null = null
  if (filters.startDate) {
    const start = localDateStart(filters.startDate)
    if (!start) throw new Error('Choose a valid start date.')
    startedAt = start.toISOString()
  }
  if (filters.endDate) {
    const end = localDateStart(filters.endDate)
    if (!end) throw new Error('Choose a valid end date.')
    endedBefore = nextLocalDay(end).toISOString()
  }
  const search = filters.search?.trim() ?? ''
  const searchId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(search) ? search : null
  const searchDate = searchId ? null : localDateStart(search)
  const sort = filters.sort ?? 'newest'
  const { data: cursorRows, error: cursorError } = await client().rpc('completed_shift_history_page', {
    p_started_at: startedAt,
    p_ended_before: endedBefore,
    p_wage_profile_id: filters.wageProfileId && filters.wageProfileId !== 'no-profile' ? filters.wageProfileId : null,
    p_no_profile: filters.wageProfileId === 'no-profile',
    p_with_tips_only: Boolean(filters.withTipsOnly),
    p_missing_wage_only: Boolean(filters.missingWageOnly),
    p_search: search || null,
    p_search_id: searchId,
    p_search_started_at: searchDate?.toISOString() ?? null,
    p_search_ended_before: searchDate ? nextLocalDay(searchDate).toISOString() : null,
    p_sort: sort === 'most-tips' ? 'tips' : sort === 'highest-rate' ? 'hourly_rate' : sort,
    p_cursor_started_at: cursor?.startedAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_cursor_value: cursor?.sortValue ?? null,
  })
  if (cursorError) throw cursorError
  // PostgREST serializes bigint columns as strings; retain the exact cursor value.
  const ordered = (cursorRows ?? []) as { shift_id: string; started_at: string; sort_value: number | string | null }[]
  const pageRows = ordered.slice(0, pageSize)
  const ids = pageRows.map((item) => item.shift_id)
  if (!ids.length) {
    return { shifts: [], hasMore: false, pageSize, nextCursor: null }
  }
  const { data, error } = await client().from('shifts').select(fields)
    .eq('user_id', userId).not('ended_at', 'is', null).in('id', ids)
  if (error) throw error
  const byId = new Map((data ?? []).map((row) => {
    const shift = asShift(row)
    return [shift.id, shift]
  }))
  const visible = ids.map((id) => byId.get(id)).filter((shift): shift is ShiftRecord => Boolean(shift))
  const last = pageRows[pageRows.length - 1]
  return {
    shifts: visible,
    hasMore: ordered.length > pageSize,
    pageSize,
    nextCursor: ordered.length > pageSize && last ? { startedAt: last.started_at, id: last.shift_id, sortValue: last.sort_value } : null,
  }
}

async function loadRecentShifts(userId: string) {
  const { data, error } = await client().from('shifts').select(fields)
    .eq('user_id', userId).not('ended_at', 'is', null)
    .order('started_at', { ascending: false }).order('id', { ascending: false })
    .limit(recentShiftLimit + 1)
  if (error) throw error
  const rows = (data ?? []).map(asShift)
  return { shifts: rows.slice(0, recentShiftLimit), hasMore: rows.length > recentShiftLimit }
}

export async function loadShiftSnapshot(userId: string) {
  const [activeResult, history] = await Promise.all([
    client().from('shifts').select(fields)
      .eq('user_id', userId).is('ended_at', null).maybeSingle(),
    loadRecentShifts(userId),
  ])
  if (activeResult.error) throw activeResult.error
  return { active: activeResult.data ? asShift(activeResult.data) : null, ...history }
}

export async function loadShift(userId: string, shiftId: string): Promise<ShiftRecord> {
  const { data, error } = await client().from('shifts').select(fields)
    .eq('id', shiftId).eq('user_id', userId).single()
  if (error) throw error
  return asShift(data)
}

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw error
  return data as T
}

/** Convert Supabase/PostgREST failures to short, safe messages for the shift editor. */
export function manualShiftErrorMessage(cause: unknown) {
  const error = cause && typeof cause === 'object' ? cause as Record<string, unknown> : null
  const code = typeof error?.code === 'string' ? error.code : ''
  const status = typeof error?.status === 'number' ? error.status : 0
  const message = typeof error?.message === 'string' ? error.message : ''
  const internal = `${message} ${typeof error?.details === 'string' ? error.details : ''}`.toLowerCase()

  if (code === '23P01' || (/overlap/.test(internal) && !/break/.test(internal))) return 'These times overlap another shift. Choose a different time range.'
  if (code === 'PGRST202' || code === 'PGRST203' || code === 'PGRST204' || /schema cache|could not find the function|function .* does not exist/.test(internal)) {
    return 'Shift saving is temporarily unavailable because the shift service is out of date. Contact support.'
  }
  if (status === 401 || code === '401' || /sign in required|jwt expired|not authenticated/.test(internal)) {
    return 'Your session has expired. Sign in again, then retry.'
  }
  if (code === '42501' || status === 403) return 'You do not have permission to change this shift. Refresh and try again.'
  if (code === '40001') return 'This shift changed elsewhere. Refresh it before saving again.'
  if (code === '22023' || code === '22007' || code === '22008' || code === '22003' || code === '23514') {
    if (/break/.test(internal) && /overlap/.test(internal)) return 'Breaks cannot overlap.'
    if (/break/.test(internal) && /boundar|within/.test(internal)) return 'Each break must fall within the shift times.'
    if (/break/.test(internal)) return 'Check the break times and try again.'
    if (/past/.test(internal)) return 'The shift must end in the past.'
    if (/24 hours/.test(internal)) return 'A shift cannot be longer than 24 hours.'
    return 'Check the shift dates, times, and wage, then try again.'
  }
  if (cause instanceof TypeError || /network|failed to fetch|networkerror|load failed/.test(internal)) {
    return 'Could not reach Velune. Check your connection and retry.'
  }
  if (/supabase is unavailable/.test(internal)) return 'Shift saving is not configured on this device. Contact support.'
  return 'Could not save this shift. Please try again.'
}

export const startShift = (id: string, wageProfileId: string | null = null, overrideCents: number | null = null) =>
  callRpc<ShiftRecord>('start_shift', {
    p_shift_id: id,
    p_wage_profile_id: wageProfileId,
    p_hourly_wage_override_cents: overrideCents,
  })
export const beginBreak = (shiftId: string, breakId: string, paid: boolean) =>
  callRpc('begin_break', { p_shift_id: shiftId, p_break_id: breakId, p_is_paid: paid })
export const endBreak = (shiftId: string, breakId: string) =>
  callRpc('end_break', { p_shift_id: shiftId, p_break_id: breakId })
export const endShift = (shiftId: string) => callRpc<ShiftRecord>('end_shift', { p_shift_id: shiftId })

export async function createManualShift(shiftId: string, requestId: string, input: ManualShiftInput) {
  return callRpc<ShiftRecord>('create_manual_shift', {
    p_shift_id: shiftId,
    p_request_id: requestId,
    p_started_at: input.started_at,
    p_ended_at: input.ended_at,
    p_wage_profile_id: input.wage_profile_id,
    p_hourly_wage_override_cents: input.hourly_wage_override_cents,
    p_breaks: input.breaks,
  })
}

export async function updateCompletedShift(shiftId: string, expectedVersion: number, input: ManualShiftInput) {
  return callRpc<ShiftRecord>('update_completed_shift', {
    p_shift_id: shiftId,
    p_expected_edit_version: expectedVersion,
    p_started_at: input.started_at,
    p_ended_at: input.ended_at,
    p_wage_profile_id: input.wage_profile_id,
    p_hourly_wage_override_cents: input.hourly_wage_override_cents,
    p_breaks: input.breaks,
  })
}

export async function deleteCompletedShift(shiftId: string) {
  try {
    await deleteAllShiftAttachments(shiftId)
  } catch {
    throw new Error('Could not finish removing this shift’s photos. The shift is still saved; some photos may already have been removed. Retry deletion to continue.')
  }
  return callRpc<void>('delete_completed_shift', { p_shift_id: shiftId })
}

/** Convert deletion failures to short, safe messages without exposing database details. */
export function deleteCompletedShiftErrorMessage(cause: unknown) {
  const error = cause && typeof cause === 'object' ? cause as Record<string, unknown> : null
  const code = typeof error?.code === 'string' ? error.code : ''
  const status = typeof error?.status === 'number' ? error.status : 0
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  if (/shift is still saved|photos/.test(message)) return cause instanceof Error ? cause.message : 'Could not finish removing this shift’s photos. The shift is still saved. Retry deletion to continue.'
  if (code === 'PGRST202' || code === 'PGRST203' || /schema cache|could not find the function|function .* does not exist/.test(message)) {
    return 'Shift deletion is temporarily unavailable because the service is out of date. Contact support.'
  }
  if (status === 401 || code === '401' || /sign in required|jwt expired|not authenticated/.test(message)) {
    return 'Your session has expired. Sign in again, then retry.'
  }
  if (code === '22023' && /active/.test(message)) return 'Active shifts cannot be deleted. End the shift first.'
  if (code === '42501') return 'This completed shift is no longer available to delete. Refresh and try again.'
  if (cause instanceof TypeError || /network|failed to fetch|networkerror|load failed/.test(message)) {
    return 'Could not reach Velune. Check your connection and retry.'
  }
  if (/supabase is unavailable/.test(message)) return 'Shift deletion is not configured on this device. Contact support.'
  return 'Could not delete this shift. Please try again.'
}
