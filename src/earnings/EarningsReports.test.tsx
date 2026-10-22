import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftRecord } from '../shift/time'
import { EarningsReports } from './EarningsReports'

const api = vi.hoisted(() => ({ loadEarningsReportShifts: vi.fn() }))
vi.mock('./reportsApi', () => api)

const shift: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a', started_at: '2026-10-19T13:00:00Z', ended_at: '2026-10-19T21:00:00Z',
  breaks: [{ id: 'b', shift_id: 'shift-a', started_at: '2026-10-19T16:00:00Z', ended_at: '2026-10-19T16:30:00Z', is_paid: false }],
  hourly_wage_cents_snapshot: 2000, wage_profile_name_snapshot: 'Day shift',
  tips: [{ id: 't', shift_id: 'shift-a', amount_cents: 2500, label: 'Cash', created_at: '', updated_at: '' }],
  tip_tax_withheld_cents: 300,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.loadEarningsReportShifts.mockResolvedValue([shift])
})
afterEach(cleanup)

describe('earnings reports UI', () => {
  it('shows report totals, the final after-withholding highlight, and profile breakdown', async () => {
    render(<EarningsReports userId="user-a" />)
    expect(await screen.findByText('$172.00')).toBeInTheDocument()
    expect(screen.getByText('Gross wages').parentElement).toHaveTextContent('$150.00')
    expect(screen.getByText('Total tips').parentElement).toHaveTextContent('$25.00')
    expect(screen.getByText('Gross earnings').parentElement).toHaveTextContent('$175.00')
    expect(screen.getByText('Recorded tip withholding').parentElement).toHaveTextContent('$3.00')
    expect(screen.getByText('Earnings after tip withholding').parentElement).toHaveTextContent('$172.00')
    expect(screen.getByText('Not final net pay. Hourly-wage taxes and other deductions are not included.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wage profile breakdown' })).toBeInTheDocument()
    expect(screen.getByText('Day shift')).toBeInTheDocument()
  })

  it('loads previous periods and applies custom date ranges', async () => {
    render(<EarningsReports userId="user-a" />)
    await screen.findByText('$172.00')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(api.loadEarningsReportShifts).toHaveBeenCalledTimes(2))
    expect(api.loadEarningsReportShifts.mock.calls[1]?.[1].startDate).toBe('2026-10-12')

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    await waitFor(() => expect(api.loadEarningsReportShifts).toHaveBeenCalledTimes(3))
    fireEvent.click(screen.getByRole('button', { name: 'Custom dates' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    await waitFor(() => expect(api.loadEarningsReportShifts).toHaveBeenCalledTimes(4))
    expect(api.loadEarningsReportShifts.mock.calls[3]?.[1]).toEqual({ startDate: '2026-10-01', endDate: '2026-10-05' })
  })

  it('shows clean empty and error states', async () => {
    api.loadEarningsReportShifts.mockResolvedValueOnce([])
    const view = render(<EarningsReports userId="user-a" />)
    expect(await screen.findByRole('heading', { name: 'No shifts in this period' })).toBeInTheDocument()
    view.unmount()
    api.loadEarningsReportShifts.mockRejectedValueOnce(new Error('database details must stay private'))
    render(<EarningsReports userId="user-a" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load earnings for this period')
    expect(screen.queryByText('database details must stay private')).not.toBeInTheDocument()
  })

  it('labels partial totals as known subtotals and reports missing wage snapshots', async () => {
    api.loadEarningsReportShifts.mockResolvedValueOnce([
      shift,
      {
        ...shift,
        id: 'legacy-shift',
        started_at: '2026-10-20T13:00:00Z',
        ended_at: '2026-10-20T21:00:00Z',
        hourly_wage_cents_snapshot: null,
        wage_profile_name_snapshot: null,
        tips: [{ id: 'legacy-tip', shift_id: 'legacy-shift', amount_cents: 500, label: null, created_at: '', updated_at: '' }],
        tip_tax_withheld_cents: null,
      },
    ])
    render(<EarningsReports userId="user-a" />)
    expect(await screen.findByText('Known earnings after tip withholding')).toBeInTheDocument()
    expect(screen.getByText('$177.00')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Wage information is missing for 1 shift')
    expect(screen.getByText('Known gross wages').parentElement).toHaveTextContent('$150.00')
    expect(screen.getByText('Gross earnings').parentElement).toHaveTextContent('Incomplete')
    expect(screen.queryByText('Earnings after tip withholding')).not.toBeInTheDocument()
  })
})
