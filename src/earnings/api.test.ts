import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTip } from './api'

const db = vi.hoisted(() => ({ insertResult: {} as unknown, lookupResult: {} as unknown, insert: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (value: unknown) => { db.insert(value); return { select: () => ({ single: async () => db.insertResult }) } },
      select: () => ({ eq: () => ({ single: async () => db.lookupResult }) }),
    }),
  },
}))

const tip = { id: 'tip-a', shift_id: 'shift-a', amount_cents: 1250, label: 'Cash' as const }

beforeEach(() => { vi.clearAllMocks() })

describe('tip create retry', () => {
  it('accepts the original owned row after a duplicate UUID response', async () => {
    db.insertResult = { data: null, error: { code: '23505' } }
    db.lookupResult = { data: { ...tip, created_at: '', updated_at: '' }, error: null }
    await expect(createTip(tip)).resolves.toMatchObject(tip)
    expect(db.insert).toHaveBeenCalledWith(tip)
  })

  it('rejects a reused UUID with different tip data', async () => {
    db.insertResult = { data: null, error: { code: '23505' } }
    db.lookupResult = { data: { ...tip, amount_cents: 2500 }, error: null }
    await expect(createTip(tip)).rejects.toThrow('already used')
  })

  it('does not claim a non-duplicate error was saved', async () => {
    db.insertResult = { data: null, error: { code: '42501', message: 'Not allowed' } }
    await expect(createTip(tip)).rejects.toMatchObject({ code: '42501' })
  })
})
