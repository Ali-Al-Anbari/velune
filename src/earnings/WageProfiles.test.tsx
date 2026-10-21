import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WageProfiles } from './WageProfiles'
import type { WageProfile } from './api'

const api = vi.hoisted(() => ({ loadWageProfiles: vi.fn(), createWageProfile: vi.fn(), updateWageProfile: vi.fn(), archiveWageProfile: vi.fn(), setDefaultWageProfile: vi.fn() }))
vi.mock('./api', () => api)

const profile: WageProfile = {
  id: 'profile-a', user_id: 'user-a', name: 'Day Shift', hourly_wage_cents: 1850,
  normally_tipped: true, include_tips_in_tax_estimate: true, estimated_withholding_bps: 1500,
  is_default: false, is_archived: false, created_at: '', updated_at: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.loadWageProfiles.mockResolvedValue([])
  api.createWageProfile.mockResolvedValue(profile)
  api.updateWageProfile.mockResolvedValue(profile)
  api.archiveWageProfile.mockResolvedValue(undefined)
  api.setDefaultWageProfile.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('wage profiles screen', () => {
  it('creates a valid profile and sets the first as default', async () => {
    let savedProfiles: WageProfile[] = []
    api.loadWageProfiles.mockImplementation(async () => savedProfiles)
    api.createWageProfile.mockImplementation(async () => { savedProfiles = [profile]; return profile })
    api.setDefaultWageProfile.mockImplementation(async () => { savedProfiles = [{ ...profile, is_default: true }] })
    render(<WageProfiles userId="user-a" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Day Shift' } })
    fireEvent.change(screen.getByLabelText('Hourly wage ($)'), { target: { value: '18.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(api.createWageProfile).toHaveBeenCalledWith('user-a', { name: 'Day Shift', hourly_wage_cents: 1850, normally_tipped: false }))
    await waitFor(() => expect(api.setDefaultWageProfile).toHaveBeenCalledWith('profile-a'))
    expect(await screen.findByText('Day Shift')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('edits, sets default, and archives an existing profile', async () => {
    let savedProfiles = [profile]
    api.loadWageProfiles.mockImplementation(async () => savedProfiles)
    api.updateWageProfile.mockImplementation(async (_user: string, _id: string, input: Partial<WageProfile>) => {
      savedProfiles = [{ ...savedProfiles[0]!, ...input }]
      return savedProfiles[0]
    })
    api.setDefaultWageProfile.mockImplementation(async () => { savedProfiles = [{ ...savedProfiles[0]!, is_default: true }] })
    api.archiveWageProfile.mockImplementation(async () => { savedProfiles = [{ ...savedProfiles[0]!, is_default: false, is_archived: true }] })
    render(<WageProfiles userId="user-a" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Hourly wage ($)'), { target: { value: '21.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(api.updateWageProfile).toHaveBeenCalledWith('user-a', 'profile-a', expect.objectContaining({ hourly_wage_cents: 2125 })))
    fireEvent.click(screen.getByRole('button', { name: 'Set default' }))
    await waitFor(() => expect(api.setDefaultWageProfile).toHaveBeenCalledWith('profile-a'))
    expect(await screen.findByText('Default')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive profile' }))
    await waitFor(() => expect(api.archiveWageProfile).toHaveBeenCalledWith('user-a', 'profile-a'))
    expect(await screen.findByRole('heading', { name: 'Archived profiles' })).toBeInTheDocument()
  })

  it('validates profile name and wage before saving', async () => {
    render(<WageProfiles userId="user-a" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('Hourly wage ($)'), { target: { value: '18.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(screen.getByRole('alert')).toHaveTextContent('meaningful name')
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Night Shift' } })
    fireEvent.change(screen.getByLabelText('Hourly wage ($)'), { target: { value: '18.999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(screen.getByRole('alert')).toHaveTextContent('hourly wage')
    expect(api.createWageProfile).not.toHaveBeenCalled()
  })

  it('omits profile level tax controls from create and edit forms and profile cards', async () => {
    api.loadWageProfiles.mockResolvedValue([profile])
    render(<WageProfiles userId="user-a" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    expect(screen.queryByText(/Include tips in future tax estimates/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Estimated withholding/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText(/Include tips in future tax estimates/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Estimated withholding/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/tips included in Velune/i)).not.toBeInTheDocument()
  })
})
