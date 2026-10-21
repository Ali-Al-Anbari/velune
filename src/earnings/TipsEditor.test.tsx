import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TipsEditor } from './TipsEditor'
import type { ShiftRecord } from '../shift/time'
import type { Tip } from './api'

const api = vi.hoisted(() => ({ createTip: vi.fn(), updateTip: vi.fn(), deleteTip: vi.fn() }))
vi.mock('./api', () => api)

let serverTips: Tip[] = []
function Harness({ ended = false }: { ended?: boolean }) {
  const [tips, setTips] = useState<Tip[]>([])
  const shift: ShiftRecord = { id: 'shift-a', user_id: 'user-a', started_at: '', ended_at: ended ? '' : null, breaks: [], tips }
  return <TipsEditor shift={shift} onChanged={async () => setTips([...serverTips])} />
}

beforeEach(() => {
  vi.clearAllMocks(); serverTips = []
  api.createTip.mockImplementation(async (input: Tip) => {
    const tip = { ...input, created_at: '', updated_at: '' }
    if (!serverTips.some((old) => old.id === tip.id)) serverTips.push(tip)
    return tip
  })
  api.updateTip.mockImplementation(async (_shiftId: string, tipId: string, amount: number, label: Tip['label']) => {
    serverTips = serverTips.map((tip) => tip.id === tipId ? { ...tip, amount_cents: amount, label } : tip)
    return serverTips[0]
  })
  api.deleteTip.mockImplementation(async (_shiftId: string, tipId: string) => { serverTips = serverTips.filter((tip) => tip.id !== tipId) })
})
afterEach(cleanup)

describe('tips editor', () => {
  it('adds, edits, and deletes a tip after a shift ends', async () => {
    render(<Harness ended />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage tips' }))
    fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '12.50' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tip' }))
    await waitFor(() => expect(screen.getByText('$12.50')).toBeInTheDocument())
    expect(api.createTip.mock.calls[0]?.[0].amount_cents).toBe(1250)
    fireEvent.click(screen.getByRole('button', { name: 'Manage tips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '15.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tip' }))
    await waitFor(() => expect(screen.getByText('$15.00')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Manage tips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('$15.00')
    fireEvent.click(screen.getByRole('button', { name: 'Delete tip' }))
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
  })

  it('retries an uncertain tip save with the same request ID and no duplicate total', async () => {
    api.createTip.mockRejectedValueOnce(new Error('Connection lost'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage tips' }))
    fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '5.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    fireEvent.click(screen.getByRole('button', { name: 'Retry tip' }))
    await waitFor(() => expect(api.createTip).toHaveBeenCalledTimes(2))
    expect(api.createTip.mock.calls[1]?.[0].id).toBe(api.createTip.mock.calls[0]?.[0].id)
    await waitFor(() => expect(screen.getByText('$5.25')).toBeInTheDocument())
    expect(serverTips).toHaveLength(1)
  })
})
