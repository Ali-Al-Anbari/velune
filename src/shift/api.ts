import { supabase } from '../lib/supabase'
import type { ShiftRecord } from './time'

const pageSize = 20
const fields = 'id, user_id, started_at, ended_at, breaks(id, shift_id, started_at, ended_at, is_paid)'

function client() {
  if (!supabase) throw new Error('Supabase is unavailable.')
  return supabase
}

function asShift(row: unknown): ShiftRecord {
  const shift = row as ShiftRecord
  return { ...shift, breaks: [...(shift.breaks ?? [])].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)) }
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

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw error
  return data as T
}

export const startShift = (id: string) => callRpc<ShiftRecord>('start_shift', { p_shift_id: id })
export const beginBreak = (shiftId: string, breakId: string, paid: boolean) =>
  callRpc('begin_break', { p_shift_id: shiftId, p_break_id: breakId, p_is_paid: paid })
export const endBreak = (shiftId: string, breakId: string) =>
  callRpc('end_break', { p_shift_id: shiftId, p_break_id: breakId })
export const endShift = (shiftId: string) => callRpc<ShiftRecord>('end_shift', { p_shift_id: shiftId })
