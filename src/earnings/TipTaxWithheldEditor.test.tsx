import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TipTaxWithheldEditor } from './TipTaxWithheldEditor'
import type { ShiftRecord } from '../shift/time'

const api = vi.hoisted(() => ({ setShiftTipTaxWithheld: vi.fn() }))
vi.mock('./api', () => ({ setShiftTipTaxWithheld: api.setShiftTipTaxWithheld }))

const shift: ShiftRecord = {
  id: 'shift-a', user_id: 'user-a', started_at: '2026-10-21T09:00:00Z', ended_at: null, breaks: [],
}

beforeEach(() => { vi.clearAllMocks(); api.setShiftTipTaxWithheld.mockResolvedValue(undefined) })
afterEach(cleanup)

describe('tip tax withholding editor', () => {
  it('starts blank when no amount has been entered and saves explicit zero', async () => {
    render(<TipTaxWithheldEditor shift={shift} onChanged={async () => {}} />)
    expect(screen.queryByLabelText('Tip tax withheld ($)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit tip tax withholding' }))
    const amount = screen.getByLabelText('Tip tax withheld ($)')
    expect(amount).toHaveValue('')
    expect(amount).toHaveAttribute('placeholder', 'Not entered')
    fireEvent.change(amount, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save withholding' }))
    await waitFor(() => expect(api.setShiftTipTaxWithheld).toHaveBeenCalledWith('shift-a', 0))
  })

  it('saves positive cents for a completed shift', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    render(<TipTaxWithheldEditor shift={{ ...shift, ended_at: '2026-10-21T17:00:00Z' }} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tip tax withholding' }))
    fireEvent.change(screen.getByLabelText('Tip tax withheld ($)'), { target: { value: '5.29' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save withholding' }))
    await waitFor(() => expect(api.setShiftTipTaxWithheld).toHaveBeenCalledWith('shift-a', 529))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent('saved')
  })

  it('clears recorded withholding after a shift has ended while preserving blank versus zero', async () => {
    render(<TipTaxWithheldEditor shift={{ ...shift, ended_at: '2026-10-21T17:00:00Z', tip_tax_withheld_cents: 325 }} onChanged={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tip tax withholding' }))
    const amount = screen.getByLabelText('Tip tax withheld ($)')
    expect(amount).toHaveValue('3.25')
    fireEvent.change(amount, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save withholding' }))
    await waitFor(() => expect(api.setShiftTipTaxWithheld).toHaveBeenCalledWith('shift-a', null))
  })

  it('displays an explicitly saved zero as $0.00 instead of blank', () => {
    render(<TipTaxWithheldEditor shift={{ ...shift, tip_tax_withheld_cents: 0 }} onChanged={async () => {}} />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.queryByText('Not entered')).not.toBeInTheDocument()
  })

  it('rejects negative or malformed values without sending a save', async () => {
    render(<TipTaxWithheldEditor shift={shift} onChanged={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tip tax withholding' }))
    fireEvent.change(screen.getByLabelText('Tip tax withheld ($)'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save withholding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('$0.00')
    expect(api.setShiftTipTaxWithheld).not.toHaveBeenCalled()
  })

  it('does not show a failed save as successful', async () => {
    api.setShiftTipTaxWithheld.mockRejectedValue(new Error('Not allowed'))
    render(<TipTaxWithheldEditor shift={shift} onChanged={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tip tax withholding' }))
    fireEvent.change(screen.getByLabelText('Tip tax withheld ($)'), { target: { value: '3.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save withholding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
