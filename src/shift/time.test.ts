import { describe, expect, it } from 'vitest'
import { formatDuration, shiftTotals, type ShiftRecord } from './time'

const shift: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a',
  started_at: '2026-11-01T00:30:00-04:00',
  ended_at: '2026-11-01T03:30:00-05:00',
  breaks: [
    { id: 'paid', shift_id: 'shift-a', started_at: '2026-11-01T01:15:00-04:00', ended_at: '2026-11-01T01:30:00-04:00', is_paid: true },
    { id: 'unpaid', shift_id: 'shift-a', started_at: '2026-11-01T01:15:00-05:00', ended_at: '2026-11-01T01:45:00-05:00', is_paid: false },
  ],
}

describe('shift durations', () => {
  it('uses absolute timestamps through daylight saving changes and multiple breaks', () => {
    expect(shiftTotals(shift, Date.now())).toEqual({
      elapsedMs: 4 * 3600000,
      paidBreakMs: 15 * 60000,
      unpaidBreakMs: 30 * 60000,
      workedMs: 3.5 * 3600000,
    })
  })

  it('handles overnight shifts and active unpaid breaks after an app reload', () => {
    const active: ShiftRecord = {
      ...shift, started_at: '2026-10-20T23:00:00-04:00', ended_at: null,
      breaks: [{ id: 'b', shift_id: shift.id, started_at: '2026-10-21T00:00:00-04:00', ended_at: null, is_paid: false }],
    }
    expect(shiftTotals(active, Date.parse('2026-10-21T01:30:00-04:00'))).toEqual({
      elapsedMs: 2.5 * 3600000, paidBreakMs: 0, unpaidBreakMs: 1.5 * 3600000, workedMs: 3600000,
    })
  })

  it('counts paid active breaks as worked and prevents negative duration', () => {
    const active = { ...shift, ended_at: null, breaks: [{ ...shift.breaks[0]!, ended_at: null }] }
    expect(shiftTotals(active, Date.parse('2026-11-01T01:30:00-04:00')).workedMs).toBe(3600000)
    expect(shiftTotals(active, Date.parse('2026-10-31T23:00:00-04:00')).workedMs).toBe(0)
    expect(formatDuration(3 * 3600000 + 61000)).toBe('03:01:01')
  })
})
