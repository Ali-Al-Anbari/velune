import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftLogger } from './ShiftLogger'
import type { ShiftRecord } from './time'

const api = vi.hoisted(() => ({
  loadShiftSnapshot: vi.fn(), loadShiftPage: vi.fn(), startShift: vi.fn(),
  beginBreak: vi.fn(), endBreak: vi.fn(), endShift: vi.fn(),
}))
vi.mock('./api', () => api)

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
  api.startShift.mockResolvedValue(base)
  api.beginBreak.mockResolvedValue({})
  api.endBreak.mockResolvedValue({})
  api.endShift.mockResolvedValue(base)
})
afterEach(cleanup)

describe('shift logger', () => {
  it('restores a persisted active shift and its active break', async () => {
    const active = { ...base, breaks: [{ id: 'break-a', shift_id: base.id, started_at: base.started_at, ended_at: null, is_paid: false }] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(active))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('On an unpaid break')
    expect(screen.getByRole('heading', { name: 'Break Time' })).toBeInTheDocument()
    expect(screen.getByText(/^Unpaid ·/)).toBeInTheDocument()
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

  it('defaults to unpaid, supports paid breaks, and resets the toggle for each break', async () => {
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    render(<ShiftLogger userId="user-a" />)
    await screen.findByRole('heading', { name: 'Current shift' })
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('switch', { name: 'Paid break' }))
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledTimes(1))
    expect(api.beginBreak.mock.calls[0]?.[2]).toBe(true)
    expect(screen.getByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledTimes(2))
    expect(api.beginBreak.mock.calls[1]?.[2]).toBe(false)
  })

  it('starts an unpaid break when the paid toggle is left off', async () => {
    api.loadShiftSnapshot.mockResolvedValue(snapshot(base))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('switch', { name: 'Paid break' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(api.beginBreak).toHaveBeenCalledOnce())
    expect(api.beginBreak.mock.calls[0]?.[2]).toBe(false)
  })

  it('shows one combined break total with only the categories that exist', async () => {
    const active = { ...base, breaks: [
      { id: 'paid', shift_id: base.id, started_at: new Date(Date.now() - 120000).toISOString(), ended_at: new Date(Date.now() - 60000).toISOString(), is_paid: true },
      { id: 'unpaid', shift_id: base.id, started_at: new Date(Date.now() - 60000).toISOString(), ended_at: null, is_paid: false },
    ] }
    api.loadShiftSnapshot.mockResolvedValue(snapshot(active))
    render(<ShiftLogger userId="user-a" />)
    expect(await screen.findByRole('heading', { name: 'Break Time' })).toBeInTheDocument()
    expect(screen.getByText(/^Paid ·/)).toBeInTheDocument()
    expect(screen.getByText(/^Unpaid ·/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('On an unpaid break')
  })

  it('confirms ending a shift while on break and shows its saved summary', async () => {
    const active = { ...base, breaks: [{ id: 'b', shift_id: base.id, started_at: base.started_at, ended_at: null, is_paid: false }] }
    api.loadShiftSnapshot.mockResolvedValueOnce(snapshot(active)).mockResolvedValue(snapshot(null, [{ ...active, ended_at: new Date().toISOString(), breaks: [{ ...active.breaks[0]!, ended_at: new Date().toISOString() }] }]))
    render(<ShiftLogger userId="user-a" />)
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Your active unpaid break will end at the same time.')
    expect(api.endShift).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end shift' }))
    expect(await screen.findByRole('heading', { name: 'Completed shift summary' })).toBeInTheDocument()
    expect(api.endShift).toHaveBeenCalledWith(base.id)
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
    fireEvent.click(await screen.findByRole('switch', { name: 'Paid break' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A break is already active')
    expect(screen.queryByRole('heading', { name: 'On a paid break' })).not.toBeInTheDocument()
  })
})
