import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftLogger } from './ShiftLogger'
import { localDateTimeInput, type ShiftRecord } from './time'

const api = vi.hoisted(() => ({
  loadShiftSnapshot: vi.fn(), loadShiftPage: vi.fn(), loadShift: vi.fn(), startShift: vi.fn(),
  beginBreak: vi.fn(), endBreak: vi.fn(), endShift: vi.fn(),
  createManualShift: vi.fn(), updateCompletedShift: vi.fn(), deleteCompletedShift: vi.fn(),
}))
const earnings = vi.hoisted(() => ({ loadWageProfiles: vi.fn() }))
vi.mock('./api', () => api)
vi.mock('../earnings/api', () => ({ loadWageProfiles: earnings.loadWageProfiles, createTip: vi.fn(), updateTip: vi.fn(), deleteTip: vi.fn() }))

const base: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a', started_at: new Date(Date.now() - 3600000).toISOString(),
  ended_at: null, breaks: [],
}
const snapshot = (active: ShiftRecord | null, shifts: ShiftRecord[] = []) => ({ active, shifts, hasMore: false })

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  api.loadShiftSnapshot.mockResolvedValue(snapshot(null))
  api.loadShiftPage.mockResolvedValue({ shifts: [], hasMore: false })
  api.loadShift.mockResolvedValue(base)
  api.startShift.mockResolvedValue(base)
  api.beginBreak.mockResolvedValue({})
  api.endBreak.mockResolvedValue({})
  api.endShift.mockResolvedValue(base)
  api.createManualShift.mockResolvedValue(base)
  api.updateCompletedShift.mockResolvedValue(base)
  api.deleteCompletedShift.mockResolvedValue(undefined)
  earnings.loadWageProfiles.mockResolvedValue([])
})
afterEach(cleanup)

describe('shift logger', () => {
  it('restores a persisted active shift and its active break', async () => {
    const active = { ...base, breaks: [{ id: 'break-a', shift_id: base.id, started_at: base.started_at, ended_at: null, is_paid: false }] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(active))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('On break')
    expect(screen.getByLabelText('Break elapsed time')).toBeInTheDocument()
    expect(screen.getByText('Unpaid break')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End break' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Paid break' })).not.toBeInTheDocument()
  })

  it('starts a shift once despite rapid clicks and loads its saved state', async () => {
    let resolve!: (value: unknown) => void
    api.startShift.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<ShiftLogger userId="user-a" />)
    const button = await screen.findByRole('button', { name: 'Start shift' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(api.startShift).toHaveBeenCalledOnce()
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    resolve(base)
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
  })

  it('selects the default profile, supports another profile and an integer wage override', async () => {
    earnings.loadWageProfiles.mockResolvedValue([
      { id: 'day', name: 'Day Shift', hourly_wage_cents: 1850, is_default: true, is_archived: false },
      { id: 'night', name: 'Night Shift', hourly_wage_cents: 2250, is_default: false, is_archived: false },
    ])
    render(<ShiftLogger userId="user-a" />)
    const select = await screen.findByLabelText('Wage profile')
    expect(select).toHaveValue('day')
    fireEvent.change(select, { target: { value: 'night' } })
    fireEvent.change(screen.getByLabelText(/Hourly wage override/), { target: { value: '24.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(api.startShift).toHaveBeenCalledOnce())
    expect(api.startShift.mock.calls[0]?.slice(1)).toEqual(['night', 2475])
  })

  it('shows the saved wage snapshot and gross earnings even after the profile changes', async () => {
    const saved = { ...base, started_at: new Date('2026-10-20T22:00:00-04:00').toISOString(), ended_at: new Date('2026-10-21T06:00:00-04:00').toISOString(), wage_profile_id: 'day',
      wage_profile_name_snapshot: 'Day Shift', hourly_wage_cents_snapshot: 1850,
      hourly_wage_override_cents: null, tip_tax_withheld_cents: 350, breaks: [{ id: 'break-saved', shift_id: base.id,
        started_at: '2026-10-21T01:00:00-04:00', ended_at: '2026-10-21T01:15:00-04:00', is_paid: true }],
      tips: [{ id: 'tip-saved', shift_id: base.id, amount_cents: 2500, label: 'Cash' as const, created_at: '2026-10-21T06:00:00-04:00', updated_at: '2026-10-21T06:00:00-04:00' }] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(null, [saved]))
    earnings.loadWageProfiles.mockResolvedValue([{ id: 'day', name: 'Renamed Shift', hourly_wage_cents: 2500, is_default: true, is_archived: false }])
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByText('Day Shift')).toBeInTheDocument()
    expect(screen.getByText('$18.50')).toBeInTheDocument()
    const card = screen.getByRole('article')
    expect(card).toHaveTextContent('Tue, Oct 20')
    expect(card).toHaveTextContent('Wed, Oct 21')
    expect(card).toHaveTextContent('8h 00m')
    expect(card).toHaveTextContent('$148.00')
    expect(card).toHaveTextContent('$25.00')
    expect(card).toHaveTextContent('Gross earnings')
    expect(card).toHaveTextContent('$173.00')
    expect(card).toHaveTextContent('Tip tax withheld−$3.50')
    expect(card).toHaveTextContent('After tip withholding')
    expect(card).toHaveTextContent('$169.50')
    expect(card).toHaveTextContent('Hourly-wage taxes and other deductions are not included.')
    expect(within(card).getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Breaks · 15m')).toBeInTheDocument()
    expect(card).not.toHaveTextContent('Paid breaks')
    expect(card).not.toHaveTextContent('Unpaid breaks')
    const grossLabel = within(card).getByText('Gross earnings')
    expect(grossLabel.nextElementSibling).not.toHaveClass('text-[#e9a4bf]')
    const afterWithholdingLabel = within(card).getByText('After tip withholding')
    expect(afterWithholdingLabel.nextElementSibling).toHaveClass('text-[#e9a4bf]')
    const editShift = within(card).getByRole('button', { name: 'Edit shift' })
    expect(editShift).toBeVisible()
    expect(editShift.closest('details')).toBeNull()
    expect(within(card).getByRole('button', { name: 'Edit Money' })).toBeVisible()
    expect(within(card).queryByText('Shift details')).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Money' }))
    expect(within(card).getByLabelText('Tip tax withheld ($)')).toHaveValue('3.50')
    expect(within(card).getByRole('form', { name: 'Add tip' })).toBeInTheDocument()
  })

  it.each([
    ['zero', [], null],
    ['paid-only', [{ id: 'p', shift_id: base.id, started_at: '2026-10-21T10:00:00Z', ended_at: '2026-10-21T10:10:00Z', is_paid: true }], 'Breaks · 10m'],
    ['unpaid-only', [{ id: 'u', shift_id: base.id, started_at: '2026-10-21T10:00:00Z', ended_at: '2026-10-21T10:30:00Z', is_paid: false }], 'Breaks · 30m'],
    ['mixed', [
      { id: 'u', shift_id: base.id, started_at: '2026-10-21T10:00:00Z', ended_at: '2026-10-21T10:20:00Z', is_paid: false },
      { id: 'p', shift_id: base.id, started_at: '2026-10-21T10:20:00Z', ended_at: '2026-10-21T10:30:00Z', is_paid: true },
    ], 'Breaks · 30m'],
  ])('shows one compact break summary for %s history', async (_kind, breaks, summaryText) => {
    const saved = { ...base, started_at: '2026-10-21T09:00:00Z', ended_at: '2026-10-21T17:00:00Z', breaks }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(null, [saved]))
    render(<ShiftLogger userId="user-a" />)
    const card = await screen.findByRole('article')
    if (summaryText === null) {
      expect(within(card).queryByText(/Breaks ·|Paid breaks|Unpaid breaks/)).not.toBeInTheDocument()
    } else {
      expect(within(card).getByText((_, element) => element?.tagName === 'P' && element.textContent === summaryText)).toBeInTheDocument()
      expect(card).not.toHaveTextContent('Paid breaks')
      expect(card).not.toHaveTextContent('Unpaid breaks')
    }
  })

  it('keeps an explicit zero withholding visible as a deduction entry', async () => {
    const saved = { ...base, started_at: '2026-10-21T09:00:00Z', ended_at: '2026-10-21T17:00:00Z',
      hourly_wage_cents_snapshot: 2000, tip_tax_withheld_cents: 0, tips: [] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(null, [saved]))
    render(<ShiftLogger userId="user-a" />)
    const card = await screen.findByRole('article')
    expect(card).toHaveTextContent('Tip tax withheld−$0.00')
    expect(card).toHaveTextContent('After tip withholding')
  })

  it('opens Add shift from history and recalculates wages after editing a completed shift', async () => {
    const oldShift = { ...base, started_at: '2024-06-05T09:00:00Z', ended_at: '2024-06-05T17:00:00Z',
      wage_profile_id: 'profile-a', wage_profile_name_snapshot: 'Day Shift', hourly_wage_cents_snapshot: 2000,
      hourly_wage_override_cents: null, manual_edit_version: 0,
      breaks: [{ id: 'break-a', shift_id: base.id, started_at: '2024-06-05T12:00:00Z', ended_at: '2024-06-05T12:30:00Z', is_paid: false }], tips: [] }
    const changedShift = { ...oldShift, started_at: '2024-06-05T10:00:00Z', manual_edit_version: 1 }
    api.loadShiftSnapshot.mockResolvedValueOnce(snapshot(null, [oldShift])).mockResolvedValue(snapshot(null, [changedShift]))
    api.loadShift.mockResolvedValue(changedShift)
    earnings.loadWageProfiles.mockResolvedValue([{ id: 'profile-a', user_id: 'user-a', name: 'Day Shift', hourly_wage_cents: 2500,
      normally_tipped: false, include_tips_in_tax_estimate: false, estimated_withholding_bps: null, is_default: true,
      is_archived: false, created_at: '', updated_at: '' }])
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findAllByText('$150.00')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }))
    expect(await screen.findByRole('dialog', { name: 'Add shift' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close shift editor' }))
    const card = screen.getByRole('article')
    const editButton = within(card).getByRole('button', { name: 'Edit shift' })
    expect(editButton).toBeVisible()
    expect(editButton.closest('details')).toBeNull()
    fireEvent.click(editButton)
    const editor = await screen.findByRole('dialog', { name: 'Edit shift' })
    expect(within(editor).getByLabelText('Wage profile')).toHaveValue('profile-a')
    expect(within(editor).getByLabelText(/Hourly wage override/)).toHaveValue('')
    const breakGroup = within(editor).getByRole('group', { name: 'Break 1' })
    expect(within(breakGroup).getByLabelText('Start')).toHaveValue(localDateTimeInput(oldShift.breaks[0]!.started_at))
    fireEvent.click(within(editor).getByRole('button', { name: 'Close shift editor' }))
    fireEvent.click(editButton)
    const reopenedEditor = await screen.findByRole('dialog', { name: 'Edit shift' })
    fireEvent.change(within(reopenedEditor).getByLabelText('Start date and time'), { target: { value: localDateTimeInput('2024-06-05T10:00:00Z') } })
    fireEvent.click(within(reopenedEditor).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateCompletedShift).toHaveBeenCalledOnce())
    expect(api.updateCompletedShift.mock.calls[0]?.slice(0, 2)).toEqual([oldShift.id, oldShift.manual_edit_version])
    expect(api.createManualShift).not.toHaveBeenCalled()
    expect(await screen.findAllByText('$130.00')).toHaveLength(3)
  })

  it('defaults to unpaid, supports paid breaks, and resets the toggle for each break', async () => {
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    render(<ShiftLogger userId="user-a" />)
    await screen.findByRole('heading', { name: 'Current shift' })
    expect(screen.getByLabelText('Worked time')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Paid break' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('switch', { name: 'Paid break' }))
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledTimes(1))
    expect(api.beginBreak.mock.calls[0]?.[2]).toBe(true)
    expect(screen.queryByRole('switch', { name: 'Paid break' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledTimes(2))
    expect(api.beginBreak.mock.calls[1]?.[2]).toBe(false)
  })

  it('starts an unpaid break when the paid toggle is left off', async () => {
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    render(<ShiftLogger userId="user-a" />)
    await screen.findByRole('heading', { name: 'Current shift' })
    expect(screen.queryByRole('switch', { name: 'Paid break' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledOnce())
    expect(api.beginBreak.mock.calls[0]?.[2]).toBe(false)
  })

  it('keeps the working view compact and shows only total break duration', async () => {
    const now = Date.now()
    const active = { ...base, breaks: [
      { id: 'paid', shift_id: base.id, started_at: new Date(now - 121000).toISOString(), ended_at: new Date(now - 61000).toISOString(), is_paid: true },
      { id: 'unpaid', shift_id: base.id, started_at: new Date(now - 61000).toISOString(), ended_at: new Date(now - 1000).toISOString(), is_paid: false },
    ] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(active))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
    expect(await screen.findByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Time worked')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.includes('Breaks 2m') === true)).toBeInTheDocument()
    expect(screen.queryByText(/Paid 1m/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Break Time' })).not.toBeInTheDocument()
  })

  it('confirms ending a shift while on break and shows its saved summary', async () => {
    const active = { ...base, breaks: [{ id: 'b', shift_id: base.id, started_at: base.started_at, ended_at: null, is_paid: false }] }
    const endedAt = new Date().toISOString()
    api.loadShiftSnapshot.mockResolvedValueOnce(snapshot(active)).mockResolvedValue(snapshot(null, [{ ...active, ended_at: endedAt, breaks: [{ ...active.breaks[0]!, ended_at: endedAt }] }]))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByText('On break')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Your active unpaid break will end at the same time.')
    expect(api.endShift).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end shift' }))
    expect(await screen.findByRole('heading', { name: 'Completed shift summary' })).toBeInTheDocument()
    expect(api.endShift).toHaveBeenCalledWith(base.id)
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('deletes a completed shift only after confirmation and refreshes history after success', async () => {
    const saved = { ...base, started_at: '2024-06-05T09:00:00Z', ended_at: '2024-06-05T17:00:00Z',
      wage_profile_id: null, wage_profile_name_snapshot: null, hourly_wage_cents_snapshot: null,
      tips: [{ id: 'tip', shift_id: base.id, amount_cents: 500, label: 'Cash' as const, created_at: '', updated_at: '' }],
      tip_tax_withheld_cents: 75 }
    api.loadShiftSnapshot.mockResolvedValueOnce(snapshot(null, [saved])).mockResolvedValue(snapshot(null, []))
    render(<ShiftLogger userId="user-a" />)
    const editButton = await screen.findByRole('button', { name: 'Edit shift' })
    fireEvent.click(editButton)
    const editor = await screen.findByRole('dialog', { name: 'Edit shift' })
    fireEvent.click(within(editor).getByRole('button', { name: 'Delete shift' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete this shift?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.deleteCompletedShift).not.toHaveBeenCalled()
    expect(screen.getByRole('article')).toBeInTheDocument()

    fireEvent.click(within(editor).getByRole('button', { name: 'Delete shift' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.deleteCompletedShift).toHaveBeenCalledWith(saved.id))
    expect(await screen.findByText('Shift deleted.')).toBeInTheDocument()
    expect(api.loadShiftSnapshot).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('ends an active break and returns to the compact working state', async () => {
    const active = { ...base, breaks: [{ id: 'b', shift_id: base.id, started_at: new Date().toISOString(), ended_at: null, is_paid: true }] }
    const resumed = { ...active, breaks: [{ ...active.breaks[0]!, ended_at: new Date().toISOString() }] }
    api.loadShiftSnapshot.mockResolvedValueOnce(snapshot(active)).mockResolvedValue(snapshot(resumed))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByText('On break')).toBeInTheDocument()
    expect(screen.getByText('Paid break')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'End break' }))
    await waitFor(() => expect(api.endBreak).toHaveBeenCalledWith(base.id, 'b'))
    expect(await screen.findByRole('button', { name: 'Break' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End shift' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Break elapsed time')).not.toBeInTheDocument()
  })

  it('does not claim an offline operation was saved and can retry', async () => {
    render(<ShiftLogger userId="user-a" />)
    const button = await screen.findByRole('button', { name: 'Start shift' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    fireEvent.click(button)
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was saved')
    expect(api.startShift).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    api.startShift.mockRejectedValueOnce(new Error('Network unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry start shift' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm the action')
    const id = api.startShift.mock.calls[0]?.[0]
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    fireEvent.click(screen.getByRole('button', { name: 'Retry start shift' }))
    await waitFor(() => expect(api.startShift).toHaveBeenCalledTimes(2))
    expect(api.startShift.mock.calls[1]?.[0]).toBe(id)
  })

  it('blocks writes when restored state cannot be loaded and offers retry', async () => {
    api.loadShiftSnapshot.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh your shifts')
    expect(screen.queryByRole('button', { name: 'Start shift' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    expect(await screen.findByRole('button', { name: 'Start shift' })).toBeInTheDocument()
  })

  it('shows database duplicate-shift rejection without claiming a save', async () => {
    api.startShift.mockRejectedValue(new Error('An active shift already exists'))
    render(<ShiftLogger userId="user-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start shift' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('An active shift already exists')
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
  })

  it('shows database duplicate-break rejection without claiming a save', async () => {
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    api.beginBreak.mockRejectedValue(new Error('A break is already active'))
    render(<ShiftLogger userId="user-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Break' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Paid break' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A break is already active')
    expect(screen.queryByRole('heading', { name: 'On a paid break' })).not.toBeInTheDocument()
  })
})
