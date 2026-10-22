import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEarningsReportShifts } from './reportsApi'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: db.from } }))

describe('earnings report data access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters shifts to the owner and half-open local period overlap, paginating without a fixed history cap', async () => {
    const records = Array.from({ length: 501 }, (_, index) => ({
      id: `shift-${index}`, user_id: 'user-a', started_at: '2026-10-20T12:00:00Z', ended_at: '2026-10-20T13:00:00Z',
      breaks: [], tips: [],
    }))
    const ranges: [number, number][] = []
    const calls: Record<string, ReturnType<typeof vi.fn>> = {}
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lt', 'or', 'order']) {
      calls[method] = vi.fn(() => builder)
      builder[method] = calls[method]
    }
    calls.range = vi.fn(async (from: number, to: number) => {
      ranges.push([from, to])
      return { data: records.slice(from, to + 1), error: null }
    })
    builder.range = calls.range
    db.from.mockReturnValue(builder)

    const shifts = await loadEarningsReportShifts('user-a', { startDate: '2026-10-19', endDate: '2026-10-25' })
    expect(shifts).toHaveLength(501)
    expect(ranges).toEqual([[0, 499], [500, 999]])
    expect(calls.eq).toHaveBeenCalledWith('user_id', 'user-a')
    expect(calls.lt).toHaveBeenCalledWith('started_at', expect.any(String))
    expect(calls.or).toHaveBeenCalledWith(expect.stringMatching(/^ended_at\.is\.null,ended_at\.gt\./))
    expect(calls.select).toHaveBeenCalledWith(expect.stringContaining('tips('))
  })

  it('propagates query errors instead of presenting a partial report', async () => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lt', 'or', 'order']) builder[method] = () => builder
    builder.range = async () => ({ data: null, error: new Error('query failed') })
    db.from.mockReturnValue(builder)
    await expect(loadEarningsReportShifts('user-a', { startDate: '2026-10-19', endDate: '2026-10-25' })).rejects.toThrow('query failed')
  })
})
