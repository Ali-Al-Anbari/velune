import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualShiftEditor } from './ManualShiftEditor'
import { localDateTimeInput, type ShiftRecord } from './time'
import type { WageProfile } from '../earnings/api'

const api = vi.hoisted(() => ({ createManualShift: vi.fn(), updateCompletedShift: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({ ...await importOriginal<typeof import('./api')>(), ...api }))

const profile: WageProfile = {
  id: 'profile-a', user_id: 'user-a', name: 'Day Shift', hourly_wage_cents: 1850,
  normally_tipped: true, include_tips_in_tax_estimate: true, estimated_withholding_bps: null,
  is_default: true, is_archived: false, created_at: '', updated_at: '',
}
const secondProfile: WageProfile = { ...profile, id: 'profile-b', name: 'Evening', hourly_wage_cents: 2200, is_default: false }
const oldStart = '2024-06-05T21:00:00.000Z'
const oldEnd = '2024-06-06T05:00:00.000Z'
const completed: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a', started_at: oldStart, ended_at: oldEnd, wage_profile_id: 'profile-a',
  wage_profile_name_snapshot: 'Old day rate', hourly_wage_cents_snapshot: 1750,
  hourly_wage_override_cents: null, manual_edit_version: 4, breaks: [
    { id: 'break-a', shift_id: 'shift-a', started_at: '2024-06-05T23:00:00.000Z', ended_at: '2024-06-05T23:20:00.000Z', is_paid: false },
  ],
  tips: [{ id: 'tip-a', shift_id: 'shift-a', amount_cents: 5000, label: 'Cash', created_at: '', updated_at: '' }],
  tip_tax_withheld_cents: 300,
}

beforeEach(() => { vi.clearAllMocks(); api.createManualShift.mockResolvedValue(completed); api.updateCompletedShift.mockResolvedValue(completed) })
afterEach(cleanup)

describe('manual shift editor', () => {
  it('creates an overnight completed shift with a default profile, override and unpaid break', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<ManualShiftEditor shift={null} profiles={[profile]} onCancel={vi.fn()} onSaved={onSaved} />)
    const dialog = screen.getByRole('dialog', { name: 'Add shift' })
    expect(within(dialog).getByLabelText('Wage profile')).toHaveValue('profile-a')
    fireEvent.change(within(dialog).getByLabelText('Start date and time'), { target: { value: localDateTimeInput(oldStart) } })
    fireEvent.change(within(dialog).getByLabelText('End date and time'), { target: { value: localDateTimeInput(oldEnd) } })
    fireEvent.change(within(dialog).getByLabelText(/Hourly wage override/), { target: { value: '20.25' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add break' }))
    const breakGroup = within(dialog).getByRole('group', { name: 'Break 1' })
    fireEvent.change(within(breakGroup).getByLabelText('Start'), { target: { value: localDateTimeInput('2024-06-05T23:30:00.000Z') } })
    fireEvent.change(within(breakGroup).getByLabelText('End'), { target: { value: localDateTimeInput('2024-06-05T23:45:00.000Z') } })
    expect(within(breakGroup).getByRole('checkbox', { name: 'Paid break' })).not.toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add break' }))
    const paidBreakGroup = within(dialog).getByRole('group', { name: 'Break 2' })
    fireEvent.change(within(paidBreakGroup).getByLabelText('Start'), { target: { value: localDateTimeInput('2024-06-06T01:00:00.000Z') } })
    fireEvent.change(within(paidBreakGroup).getByLabelText('End'), { target: { value: localDateTimeInput('2024-06-06T01:15:00.000Z') } })
    fireEvent.click(within(paidBreakGroup).getByRole('checkbox', { name: 'Paid break' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add completed shift' }))
    await waitFor(() => expect(api.createManualShift).toHaveBeenCalledOnce())
    const [, , input] = api.createManualShift.mock.calls[0]!
    expect(input.wage_profile_id).toBe('profile-a')
    expect(input.hourly_wage_override_cents).toBe(2025)
    expect(input.started_at).toBe(new Date(localDateTimeInput(oldStart)).toISOString())
    expect(input.ended_at).toBe(new Date(localDateTimeInput(oldEnd)).toISOString())
    expect(input.breaks).toHaveLength(2)
    expect(input.breaks[0].is_paid).toBe(false)
    expect(input.breaks[1].is_paid).toBe(true)
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('edits a completed shift while retaining unchanged timestamps, wage snapshot context, and breaks', async () => {
    render(<ManualShiftEditor shift={completed} profiles={[profile, secondProfile]} onCancel={vi.fn()} onSaved={async () => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Edit shift' })
    fireEvent.change(within(dialog).getByLabelText('Wage profile'), { target: { value: 'profile-b' } })
    fireEvent.change(within(dialog).getByLabelText(/Hourly wage override/), { target: { value: '23.45' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateCompletedShift).toHaveBeenCalledOnce())
    const [shiftId, version, input] = api.updateCompletedShift.mock.calls[0]!
    expect([shiftId, version]).toEqual(['shift-a', 4])
    expect(input.started_at).toBe(oldStart)
    expect(input.ended_at).toBe(oldEnd)
    expect(input.wage_profile_id).toBe('profile-b')
    expect(input.hourly_wage_override_cents).toBe(2345)
    expect(input.breaks).toEqual([{ id: 'break-a', started_at: completed.breaks[0]!.started_at, ended_at: completed.breaks[0]!.ended_at, is_paid: false }])
  })

  it('keeps the saved profile and override inputs unchanged when editing only shift times', async () => {
    const savedWage = { ...completed, hourly_wage_cents_snapshot: 1750, hourly_wage_override_cents: null }
    render(<ManualShiftEditor shift={savedWage} profiles={[{ ...profile, hourly_wage_cents: 2500 }]} onCancel={vi.fn()} onSaved={async () => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Edit shift' })
    expect(within(dialog).getByLabelText('Wage profile')).toHaveValue('profile-a')
    expect(within(dialog).getByLabelText(/Hourly wage override/)).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText('Start date and time'), { target: { value: localDateTimeInput('2024-06-05T20:00:00Z') } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateCompletedShift).toHaveBeenCalledOnce())
    const [, , input] = api.updateCompletedShift.mock.calls[0]!
    expect(input.wage_profile_id).toBe('profile-a')
    expect(input.hourly_wage_override_cents).toBeNull()
  })

  it('shows a safe classified server error instead of a generic connection message', async () => {
    api.createManualShift.mockRejectedValueOnce({ code: '23P01', message: 'This time overlaps another shift', details: 'private database detail' })
    render(<ManualShiftEditor shift={null} profiles={[]} onCancel={vi.fn()} onSaved={async () => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Add shift' })
    fireEvent.change(within(dialog).getByLabelText('Start date and time'), { target: { value: localDateTimeInput(oldStart) } })
    fireEvent.change(within(dialog).getByLabelText('End date and time'), { target: { value: localDateTimeInput(oldEnd) } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add completed shift' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('These times overlap another shift')
    expect(within(dialog).getByRole('alert')).not.toHaveTextContent('private database detail')
  })

  it('rejects overlapping breaks before making a request', async () => {
    render(<ManualShiftEditor shift={null} profiles={[]} onCancel={vi.fn()} onSaved={async () => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Add shift' })
    fireEvent.change(within(dialog).getByLabelText('Start date and time'), { target: { value: localDateTimeInput(oldStart) } })
    fireEvent.change(within(dialog).getByLabelText('End date and time'), { target: { value: localDateTimeInput(oldEnd) } })
    const cases: [string, string, string][] = [
      ['1', '2024-06-05T22:00:00.000Z', '2024-06-05T23:00:00.000Z'],
      ['2', '2024-06-05T22:30:00.000Z', '2024-06-05T23:30:00.000Z'],
    ]
    for (const [index, start, end] of cases) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add break' }))
      const group = within(dialog).getByRole('group', { name: `Break ${index}` })
      fireEvent.change(within(group).getByLabelText('Start'), { target: { value: localDateTimeInput(start) } })
      fireEvent.change(within(group).getByLabelText('End'), { target: { value: localDateTimeInput(end) } })
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add completed shift' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Breaks cannot overlap')
    expect(api.createManualShift).not.toHaveBeenCalled()
  })

  it('allows removing the final break from a completed shift', async () => {
    render(<ManualShiftEditor shift={completed} profiles={[profile]} onCancel={vi.fn()} onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('No breaks recorded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateCompletedShift).toHaveBeenCalledOnce())
    expect(api.updateCompletedShift.mock.calls[0]?.[2].breaks).toEqual([])
  })

  it('requires confirmation before discarding unsaved edits', () => {
    const onCancel = vi.fn()
    render(<ManualShiftEditor shift={completed} profiles={[profile]} onCancel={onCancel} onSaved={async () => {}} />)
    fireEvent.change(screen.getByLabelText(/Hourly wage override/), { target: { value: '21.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Your unsaved shift changes will be lost.')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows a failed save without closing the editor', async () => {
    api.createManualShift.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<ManualShiftEditor shift={null} profiles={[]} onCancel={vi.fn()} onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add completed shift' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach Velune. Check your connection and retry.')
    expect(screen.getByRole('dialog', { name: 'Add shift' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add completed shift' }))
    await waitFor(() => expect(api.createManualShift).toHaveBeenCalledTimes(2))
    expect(api.createManualShift.mock.calls[1]?.slice(0, 2)).toEqual(api.createManualShift.mock.calls[0]?.slice(0, 2))
  })
})
