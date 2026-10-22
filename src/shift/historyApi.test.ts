import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadShiftHistoryPage, loadShiftSnapshot, type ShiftHistoryFilters } from './api'

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: db.from, rpc: db.rpc } }))

function queryBuilder(data: unknown[], calls: Record<string, ReturnType<typeof vi.fn>>) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'is', 'gte', 'lt', 'ilike', 'or', 'order']) {
    calls[method] = vi.fn(() => builder)
    builder[method] = calls[method]
  }
  calls.range = vi.fn(async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }))
  calls.limit = vi.fn(async (limit: number) => ({ data: data.slice(0, limit), error: null }))
  calls.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  calls.in = vi.fn(async () => ({ data, error: null }))
  builder.range = calls.range
  builder.limit = calls.limit
  builder.maybeSingle = calls.maybeSingle
  builder.in = calls.in
  return builder
}

const rows = Array.from({ length: 5 }, (_, index) => ({
  id: `shift-${index}`, user_id: 'user-a', started_at: `2026-10-${20 + index}T12:00:00Z`, ended_at: `2026-10-${20 + index}T13:00:00Z`, breaks: [], tips: [],
}))

beforeEach(() => {
  vi.clearAllMocks()
  db.rpc.mockResolvedValue({ data: [], error: null })
})

describe('shift history queries', () => {
  it('loads only three recent rows and asks for one extra to expose the full-history link', async () => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {}
    db.from.mockImplementation(() => queryBuilder(rows, calls))
    db.rpc.mockResolvedValue({ data: [], error: null })
    const result = await loadShiftSnapshot('user-a')
    expect(result.shifts).toHaveLength(3)
    expect(result.hasMore).toBe(true)
    expect(calls.limit).toHaveBeenCalledWith(4)
    expect(calls.eq).toHaveBeenCalledWith('user_id', 'user-a')
  })

  it('delegates all filters and aggregate sorting to the server before cursor pagination', async () => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {}
    const page = Array.from({ length: 21 }, (_, index) => ({
      shift_id: `ordered-${index}`,
      started_at: `2026-10-${String(21 - Math.floor(index / 24)).padStart(2, '0')}T${String(23 - (index % 24)).padStart(2, '0')}:00:00Z`,
      sort_value: 7200000 - index * 1000,
    }))
    const pageData = page.map((item) => ({ id: item.shift_id, user_id: 'user-a', started_at: item.started_at, ended_at: item.started_at, breaks: [], tips: [] })).reverse()
    db.from.mockImplementation(() => queryBuilder(pageData, calls))
    db.rpc.mockResolvedValue({ data: page, error: null })
    const filters: ShiftHistoryFilters = {
      search: 'Night', startDate: '2026-10-20', endDate: '2026-10-25', wageProfileId: 'profile-a',
      withTipsOnly: true, missingWageOnly: true, sort: 'longest',
    }
    const cursor = { startedAt: '2026-10-21T12:00:00.000Z', id: 'cursor-id', sortValue: 2000000 }
    const result = await loadShiftHistoryPage('user-a', cursor, filters)
    expect(result.pageSize).toBe(20)
    expect(db.rpc).toHaveBeenCalledWith('completed_shift_history_page', expect.objectContaining({
      p_started_at: expect.any(String), p_ended_before: expect.any(String),
      p_wage_profile_id: 'profile-a', p_with_tips_only: true, p_missing_wage_only: true,
      p_search: 'Night', p_sort: 'longest', p_cursor_value: 2000000,
    }))
    expect(calls.in).toHaveBeenCalledWith('id', page.slice(0, 20).map((item) => item.shift_id))
    expect(result.shifts.map((shift) => shift.id)).toEqual(page.slice(0, 20).map((item) => item.shift_id))
    expect(result.nextCursor).toEqual({ startedAt: page[19]!.started_at, id: page[19]!.shift_id, sortValue: page[19]!.sort_value })
    expect(result.hasMore).toBe(true)
  })

  it('supports no-profile and local-date searches through the owner-scoped server query', async () => {
    const calls: Record<string, ReturnType<typeof vi.fn>> = {}
    db.from.mockImplementation(() => queryBuilder(rows, calls))
    await loadShiftHistoryPage('user-a', null, { search: '2026-10-21', wageProfileId: 'no-profile' })
    expect(db.rpc).toHaveBeenCalledWith('completed_shift_history_page', expect.objectContaining({
      p_no_profile: true,
      p_search_started_at: new Date(2026, 9, 21).toISOString(),
      p_search_ended_before: new Date(2026, 9, 22).toISOString(),
    }))
  })

  it.each([
    ['most-tips', 'tips'],
    ['highest-rate', 'hourly_rate'],
    ['newest', 'newest'],
    ['oldest', 'oldest'],
  ] as const)('requests %s server ordering for every matching shift', async (sort, expected) => {
    db.rpc.mockResolvedValue({ data: [], error: null })
    await loadShiftHistoryPage('user-a', null, { sort })
    expect(db.rpc).toHaveBeenCalledWith('completed_shift_history_page', expect.objectContaining({ p_sort: expected }))
  })
})
