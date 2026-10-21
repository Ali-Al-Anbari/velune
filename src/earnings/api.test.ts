import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTip, setShiftTipTaxWithheld } from './api'

const db = vi.hoisted(() => ({ insertResult: {} as unknown, lookupResult: {} as unknown, insert: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: db.rpc,
    from: () => ({
      insert: (value: unknown) => { db.insert(value); return { select: () => ({ single: async () => db.insertResult }) } },
      select: () => ({ eq: () => ({ single: async () => db.lookupResult }) }),
    }),
  },
}))

const tip = { id: 'tip-a', shift_id: 'shift-a', amount_cents: 1250, label: 'Cash' as const }

beforeEach(() => { vi.clearAllMocks(); db.rpc.mockResolvedValue({ error: null }) })

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

describe('manual tip tax withholding RPC', () => {
  it('sends only the shift ID and integer cents, including explicit zero and clearing', async () => {
    await setShiftTipTaxWithheld('shift-a', 529)
    expect(db.rpc).toHaveBeenLastCalledWith('set_shift_tip_tax_withheld', {
      p_shift_id: 'shift-a', p_tip_tax_withheld_cents: 529,
    })
    await setShiftTipTaxWithheld('shift-a', 0)
    expect(db.rpc).toHaveBeenLastCalledWith('set_shift_tip_tax_withheld', {
      p_shift_id: 'shift-a', p_tip_tax_withheld_cents: 0,
    })
    await setShiftTipTaxWithheld('shift-a', null)
    expect(db.rpc).toHaveBeenLastCalledWith('set_shift_tip_tax_withheld', {
      p_shift_id: 'shift-a', p_tip_tax_withheld_cents: null,
    })
    expect(db.rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_user_id')
  })

  it('surfaces RPC authorization failures to the editor', async () => {
    db.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'Shift not found' } })
    await expect(setShiftTipTaxWithheld('other-shift', 100)).rejects.toMatchObject({ code: '42501' })
  })
})
