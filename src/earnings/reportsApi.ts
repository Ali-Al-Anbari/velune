import { supabase } from '../lib/supabase'
import type { ShiftRecord } from '../shift/time'
import { reportPeriodBounds, type ReportPeriod } from './reportPeriods'

const pageSize = 500
const reportFields = 'id, user_id, started_at, ended_at, wage_profile_id, wage_profile_name_snapshot, hourly_wage_cents_snapshot, hourly_wage_override_cents, tip_tax_withheld_cents, breaks(id, shift_id, started_at, ended_at, is_paid), tips(id, shift_id, amount_cents, label, created_at, updated_at)'

function client() {
  if (!supabase) throw new Error('Supabase is unavailable.')
  return supabase
}

/** RLS and the explicit owner filter both apply. Range pagination has no silent history cap. */
export async function loadEarningsReportShifts(userId: string, period: ReportPeriod): Promise<ShiftRecord[]> {
  const { startAt, endExclusive } = reportPeriodBounds(period)
  const startIso = startAt.toISOString()
  const endIso = endExclusive.toISOString()
  const shifts = new Map<string, ShiftRecord>()
  let offset = 0

  while (true) {
    const { data, error } = await client().from('shifts').select(reportFields)
      .eq('user_id', userId)
      .lt('started_at', endIso)
      .or(`ended_at.is.null,ended_at.gt.${startIso}`)
      .order('started_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as ShiftRecord[]
    for (const row of rows) {
      shifts.set(row.id, {
        ...row,
        breaks: [...(row.breaks ?? [])].sort((left, right) => Date.parse(left.started_at) - Date.parse(right.started_at)),
        tips: [...(row.tips ?? [])].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)),
      })
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }

  // A valid shift starting on a report date necessarily overlaps that date's full local-day interval,
  // so this overlap query also returns every shift whose tips/withholding belong to the report.
  return [...shifts.values()]
}
