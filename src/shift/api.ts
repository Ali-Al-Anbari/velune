import { supabase } from '../lib/supabase'
import type { ShiftRecord } from './time'

const pageSize = 20
const fields = 'id, user_id, started_at, ended_at, wage_profile_id, wage_profile_name_snapshot, hourly_wage_cents_snapshot, hourly_wage_override_cents, normally_tipped_snapshot, include_tips_in_tax_estimate_snapshot, estimated_withholding_bps_snapshot, tip_tax_withheld_cents, breaks(id, shift_id, started_at, ended_at, is_paid), tips(id, shift_id, amount_cents, label, created_at, updated_at)'

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

export async function loadShiftSnapshot(userId: string) {
  const [activeResult, history] = await Promise.all([
    client().from('shifts').select(fields)
      .eq('user_id', userId).is('ended_at', null).maybeSingle(),
    loadShiftPage(userId),
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
