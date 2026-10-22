import { describe, expect, it } from 'vitest'
import { formatDuration, localDateTimeInput, parseLocalDateTimeInput, shiftTotals, validateManualShiftRange, type ShiftRecord } from './time'

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

  it('round-trips local date-time inputs into absolute timestamps', () => {
    const local = localDateTimeInput('2024-06-05T21:30:00.000Z')
    expect(parseLocalDateTimeInput(local)).toBe(new Date(local).toISOString())
  })

  it('rejects impossible local dates and invalid shift ranges', () => {
    expect(() => parseLocalDateTimeInput('2024-02-30T10:00')).toThrow('does not exist')
    expect(() => validateManualShiftRange('not a timestamp', '2024-06-05T10:00:00Z')).toThrow('valid start and end')
    expect(() => validateManualShiftRange('2024-06-05T11:00:00Z', '2024-06-05T10:00:00Z')).toThrow('earlier than')
    expect(() => validateManualShiftRange('2024-06-04T00:00:00Z', '2024-06-05T01:00:00Z')).toThrow('24 hours')
    expect(() => validateManualShiftRange('2024-06-05T09:00:00Z', '2024-06-05T11:00:00Z', Date.parse('2024-06-05T10:00:00Z'))).toThrow('past')
  })

  it('rejects daylight-saving gaps and resolves repeated local times to the earlier instant', () => {
    const runtime = globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }
    const env = runtime.process?.env
    if (!env) throw new Error('Node test environment is required for timezone validation.')
    const originalTimezone = env.TZ
    env.TZ = 'America/New_York'
    try {
      expect(() => parseLocalDateTimeInput('2026-03-08T02:30')).toThrow('does not exist')
      expect(parseLocalDateTimeInput('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z')
    } finally {
      if (originalTimezone === undefined) delete env.TZ
      else env.TZ = originalTimezone
    }
  })
})
