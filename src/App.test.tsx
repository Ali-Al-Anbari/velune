import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthSessionMissingError } from '@supabase/supabase-js'
import App from './App'

const mock = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  listener: undefined as ((event: string, session: { user: unknown } | null) => void) | undefined,
}))

vi.mock('./lib/supabase', () => ({
  supabaseConfigError: null,
  supabase: { auth: mock },
}))
vi.mock('./shift/ShiftLogger', () => ({
  ShiftLogger: () => <h1>Current shift</h1>,
}))
vi.mock('./earnings/EarningsReports', () => ({
  EarningsReports: () => <h1>Earnings reports</h1>,
}))

const confirmedUser = { id: 'user-a', email: 'a@example.com', email_confirmed_at: '2026-10-20T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  mock.listener = undefined
  window.history.replaceState(null, '', '/')
  mock.getUser.mockResolvedValue({ data: { user: null }, error: null })
  mock.onAuthStateChange.mockImplementation((listener) => {
    mock.listener = listener
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mock.signUp.mockResolvedValue({ error: null })
  mock.signInWithPassword.mockResolvedValue({ error: null })
  mock.resetPasswordForEmail.mockResolvedValue({ error: null })
  mock.updateUser.mockResolvedValue({ error: null })
  mock.signOut.mockImplementation(async () => {
    mock.listener?.('SIGNED_OUT', null)
    return { error: null }
  })
})

afterEach(cleanup)

describe('Velune authentication', () => {
  it('validates signup and explains email confirmation', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address')
    expect(mock.signUp).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(mock.signUp).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email for a verification link')
    expect(mock.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@example.com',
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    }))
  })

  it('shows login errors without entering the protected screen', async () => {
    mock.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
  })

  it('keeps the app hidden until a restored session is validated', async () => {
    window.history.replaceState(null, '', '/app')
    let finish!: (value: unknown) => void
    mock.getUser.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<App />)
    expect(screen.getByText('Opening your space…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
    finish({ data: { user: confirmedUser }, error: null })
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
  })

  it('holds an unverified account outside the protected screen', async () => {
    window.history.replaceState(null, '', '/app')
    mock.getUser.mockResolvedValue({ data: { user: { ...confirmedUser, email_confirmed_at: null } }, error: null })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
  })

  it('opens the protected screen after a successful sign-in event', async () => {
    mock.signInWithPassword.mockImplementation(async () => {
      mock.listener?.('SIGNED_IN', { user: confirmedUser })
      return { error: null }
    })
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Current shift' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app')
  })

  it('opens earnings reports from protected navigation', async () => {
    window.history.replaceState(null, '', '/app')
    mock.getUser.mockResolvedValue({ data: { user: confirmedUser }, error: null })
    render(<App />)
    await screen.findByRole('heading', { name: 'Current shift' })
    fireEvent.click(screen.getByRole('button', { name: 'Earnings' }))
    expect(await screen.findByRole('heading', { name: 'Earnings reports' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app/reports')
  })

  it('signs out and removes protected content', async () => {
    window.history.replaceState(null, '', '/app')
    mock.getUser.mockResolvedValue({ data: { user: confirmedUser }, error: null })
    render(<App />)
    await screen.findByRole('heading', { name: 'Current shift' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('protects the app route without a session', async () => {
    window.history.replaceState(null, '', '/app')
    mock.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() })
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    expect(screen.queryByRole('heading', { name: 'Current shift' })).not.toBeInTheDocument()
    expect(screen.queryByText(/could not restore your session/i)).not.toBeInTheDocument()
  })

  it('requests a reset without revealing whether an account exists', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome back' })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists')
    expect(mock.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
      redirectTo: `${window.location.origin}/auth/recovery`,
    })
  })

  it('updates the password from a recovery session and signs out', async () => {
    window.history.replaceState(null, '', '/auth/recovery#access_token=redacted')
    mock.getUser.mockResolvedValue({ data: { user: confirmedUser }, error: null })
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a new password' })
    await waitFor(() => expect(window.location.hash).toBe(''))
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-long-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'new-long-password' })
    expect(mock.signOut).toHaveBeenCalledOnce()
  })

  it('handles a failed confirmation redirect and strips its fragment', async () => {
    window.history.replaceState(null, '', '/auth/callback#error=access_denied&error_description=expired')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Link unavailable' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(screen.queryByText('expired')).not.toBeInTheDocument()
  })

  it('handles a successful confirmation redirect', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=redacted')
    mock.getUser.mockResolvedValue({ data: { user: confirmedUser }, error: null })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(window.location.pathname).toBe('/app')
  })
})
