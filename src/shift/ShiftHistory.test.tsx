import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftRecord } from './time'
import { ShiftHistory } from './ShiftHistory'
import { ShiftLogger } from './ShiftLogger'

const shiftApi = vi.hoisted(() => ({ loadShiftHistoryPage: vi.fn(), loadShift: vi.fn(), loadShiftSnapshot: vi.fn() }))
const earningsApi = vi.hoisted(() => ({ loadWageProfiles: vi.fn(), createTip: vi.fn(), updateTip: vi.fn(), deleteTip: vi.fn(), setShiftTipTaxWithheld: vi.fn() }))
vi.mock('./api', () => ({ ...shiftApi, beginBreak: vi.fn(), endBreak: vi.fn(), endShift: vi.fn(), startShift: vi.fn(), loadShiftPage: vi.fn() }))
vi.mock('../earnings/api', () => earningsApi)
vi.mock('./ShiftAttachments', () => ({ ShiftAttachments: () => null }))

const record = (id: string, day: number): ShiftRecord => ({
  id, user_id: 'user-a', started_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00Z`, ended_at: `2026-10-${String(day).padStart(2, '0')}T17:00:00Z`,
  breaks: [], tips: [], wage_profile_id: 'profile-a', wage_profile_name_snapshot: 'Day shift', hourly_wage_cents_snapshot: 2000,
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  earningsApi.loadWageProfiles.mockResolvedValue([{ id: 'profile-a', name: 'Day shift', is_archived: false }])
  shiftApi.loadShift.mockResolvedValue(record('shift-21', 21))
  shiftApi.loadShiftSnapshot.mockResolvedValue({ active: null, shifts: [], hasMore: false })
})
afterEach(cleanup)

describe('shift history navigation and list size', () => {
  it('shows at most three recent completed shifts on the main screen and links to all history', async () => {
    const records = [record('21', 21), record('20', 20), record('19', 19), record('18', 18), record('17', 17)]
    const onViewAll = vi.fn()
    shiftApi.loadShiftSnapshot.mockResolvedValue({ active: null, shifts: records, hasMore: true })
    render(<ShiftLogger userId="user-a" onViewAll={onViewAll} />)
    expect(await screen.findAllByRole('article')).toHaveLength(3)
    const viewAll = screen.getByRole('button', { name: 'View all shifts' })
    expect(viewAll).toBeVisible()
    expect(viewAll).toHaveClass('rounded-xl', 'min-h-11')
    expect(viewAll.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(viewAll)
    expect(onViewAll).toHaveBeenCalledOnce()
  })

  it('opens tips and withholding together from one Edit Money control on an active shift', async () => {
    shiftApi.loadShiftSnapshot.mockResolvedValue({ active: { ...record('active', 21), ended_at: null }, shifts: [], hasMore: false })
    render(<ShiftLogger userId="user-a" />)
    const editMoney = await screen.findByRole('button', { name: 'Edit Money' })
    expect(editMoney).toBeVisible()
    expect(editMoney).toHaveClass('rounded-xl', 'bg-[#493653]')
    expect(editMoney.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(editMoney)
    expect(screen.getByRole('form', { name: 'Add tip' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tip tax withheld ($)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage tips' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit tip tax withholding' })).not.toBeInTheDocument()
  })

  it('filters before paging and loads the next page from the full history query', async () => {
    const next = { startedAt: record('filtered', 21).started_at, id: 'filtered' }
    shiftApi.loadShiftHistoryPage.mockResolvedValueOnce({ shifts: [record('page-one', 21)], hasMore: true, pageSize: 20, nextCursor: next })
      .mockResolvedValueOnce({ shifts: [record('filtered', 21)], hasMore: true, pageSize: 20, nextCursor: next })
      .mockResolvedValueOnce({ shifts: [record('page-two', 20)], hasMore: false, pageSize: 20, nextCursor: null })
    render(<ShiftHistory userId="user-a" />)
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /shifts/i })).not.toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('Day shift')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Search profile name/), { target: { value: 'Night shift' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(shiftApi.loadShiftHistoryPage).toHaveBeenCalledWith('user-a', null, expect.objectContaining({ search: 'Night shift' })))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(shiftApi.loadShiftHistoryPage).toHaveBeenCalledWith('user-a', next, expect.objectContaining({ search: 'Night shift' })))
    expect(await screen.findByText('Page 2 · 1 shifts')).toBeInTheDocument()
  })

  it('opens the saved shift in the existing editor and keeps one Edit Money action', async () => {
    shiftApi.loadShiftHistoryPage.mockResolvedValue({ shifts: [record('shift-21', 21)], hasMore: false, pageSize: 20, nextCursor: null })
    render(<ShiftHistory userId="user-a" />)
    const editShift = await screen.findByRole('button', { name: 'Edit shift' })
    expect(editShift).toBeVisible()
    expect(editShift).toHaveClass('rounded-xl', 'min-h-11')
    expect(editShift.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(editShift)
    expect(await screen.findByRole('dialog', { name: 'Edit shift' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit Money' })).toHaveLength(1)
  })
})
