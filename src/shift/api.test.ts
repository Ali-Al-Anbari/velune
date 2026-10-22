import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createManualShift, manualShiftErrorMessage, updateCompletedShift, type ManualShiftInput } from './api'

const db = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: db.rpc },
}))

const input: ManualShiftInput = {
  started_at: '2024-06-05T21:00:00.000Z', ended_at: '2024-06-06T05:00:00.000Z',
  wage_profile_id: 'profile-a', hourly_wage_override_cents: 2025,
  breaks: [{ id: 'break-a', started_at: '2024-06-05T23:00:00.000Z', ended_at: '2024-06-05T23:15:00.000Z', is_paid: false }],
}
const loaded = { id: 'shift-a', user_id: 'user-a', started_at: input.started_at, ended_at: input.ended_at, breaks: input.breaks }

beforeEach(() => { vi.clearAllMocks(); db.rpc.mockResolvedValue({ data: loaded, error: null }) })

describe('manual shift RPC API', () => {
  it('sends the stable create and request IDs', async () => {
    await expect(createManualShift('shift-a', 'request-a', input)).resolves.toMatchObject({ id: 'shift-a' })
    expect(db.rpc).toHaveBeenCalledWith('create_manual_shift', {
      p_shift_id: 'shift-a', p_request_id: 'request-a', p_started_at: input.started_at,
      p_ended_at: input.ended_at, p_wage_profile_id: 'profile-a',
      p_hourly_wage_override_cents: 2025, p_breaks: input.breaks,
    })
  })

  it('sends the optimistic edit version with the complete atomic payload', async () => {
    await updateCompletedShift('shift-a', 7, input)
    expect(db.rpc).toHaveBeenCalledWith('update_completed_shift', {
      p_shift_id: 'shift-a', p_expected_edit_version: 7, p_started_at: input.started_at,
      p_ended_at: input.ended_at, p_wage_profile_id: 'profile-a',
      p_hourly_wage_override_cents: 2025, p_breaks: input.breaks,
    })
  })

  it('surfaces a server-side validation or ownership failure', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Completed shift not found' } })
    await expect(updateCompletedShift('guessed-id', 0, input)).rejects.toMatchObject({ code: '42501' })
  })

  it.each([
    [{ code: '23P01', message: 'This time overlaps another shift' }, 'These times overlap another shift. Choose a different time range.'],
    [{ code: '22023', message: 'Breaks cannot overlap' }, 'Breaks cannot overlap.'],
    [{ code: 'PGRST202', message: 'Could not find the function in the schema cache', details: 'private signature' }, 'Shift saving is temporarily unavailable because the shift service is out of date. Contact support.'],
    [{ code: '42501', message: 'permission denied for table shifts', details: 'internal relation details' }, 'You do not have permission to change this shift. Refresh and try again.'],
    [{ status: 401, message: 'JWT expired' }, 'Your session has expired. Sign in again, then retry.'],
    [new TypeError('Failed to fetch'), 'Could not reach Velune. Check your connection and retry.'],
    [{ code: '22023', message: 'Shift start must be earlier than shift end' }, 'Check the shift dates, times, and wage, then try again.'],
  ])('maps RPC errors to safe user messages', (cause, expected) => {
    expect(manualShiftErrorMessage(cause)).toBe(expected)
    expect(manualShiftErrorMessage(cause)).not.toMatch(/private signature|internal relation/)
  })
})
