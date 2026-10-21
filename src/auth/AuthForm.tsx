import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'reset'

const inputClass = 'w-full rounded-2xl border border-[#795c8066] bg-[#211729] px-4 py-3.5 text-base text-[#f4eaf7] outline-none placeholder:text-[#8e7e96] focus:border-[#dea3bf] focus:ring-2 focus:ring-[#dea3bf33]'
const buttonClass = 'w-full rounded-2xl bg-[#e9a4bf] px-5 py-3.5 text-base font-semibold text-[#241426] transition hover:bg-[#f2bfd2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-60'

function authMessage(message: string) {
  return /invalid login credentials/i.test(message) ? 'Email or password is incorrect.' : message
}

export function AuthForm({ initialMessage, onSignedIn }: { initialMessage?: string; onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initialMessage ?? '')

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
    setConfirmPassword('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || pending) return
    setError('')
    setNotice('')
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return
    }
    if (mode !== 'reset' && password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setPending(true)
    try {
      if (mode === 'signup') {
        const { error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
        if (authError) throw authError
        setNotice('Check your email for a verification link. Open it to confirm your account, then sign in. If the address is already registered, use sign in or reset your password.')
        setPassword('')
        setConfirmPassword('')
      } else if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (authError) throw authError
        onSignedIn()
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/auth/recovery`,
        })
        if (authError) throw authError
        setNotice('If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.')
      }
    } catch (cause) {
      setError(mode === 'reset'
        ? 'Could not send a reset link. Please try again later.'
        : authMessage(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="auth-card relative z-10 w-full max-w-md rounded-[2rem] border border-[#a17a9d3d] bg-[#241a2bbb] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8" aria-labelledby="auth-title">
      <h2 id="auth-title" className="font-serif text-3xl tracking-tight text-[#f4eaf7]">
        {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#c9bfd0]">
        {mode === 'signin' ? 'Your space is waiting.' : mode === 'signup' ? 'Start with an email and a password.' : 'We’ll send a link to your email.'}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <label className="block space-y-2 text-sm text-[#e1d3e7]">
          <span>Email</span>
          <input className={inputClass} autoComplete="email" inputMode="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        {mode !== 'reset' ? <label className="block space-y-2 text-sm text-[#e1d3e7]">
          <span>Password</span>
          <input className={inputClass} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
        </label> : null}
        {mode === 'signup' ? <label className="block space-y-2 text-sm text-[#e1d3e7]">
          <span>Confirm password</span>
          <input className={inputClass} autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
        </label> : null}
        {error ? <p role="alert" className="rounded-xl bg-[#632f49] px-4 py-3 text-sm text-[#ffe4ed]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-[#46314d] px-4 py-3 text-sm leading-relaxed text-[#f4eaf7]">{notice}</p> : null}
        <button className={buttonClass} type="submit" disabled={pending}>
          {pending ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#d6b9d0]">
        {mode !== 'signin' ? <button type="button" className="link-button" onClick={() => switchMode('signin')}>Back to sign in</button> : null}
        {mode !== 'signup' ? <button type="button" className="link-button" onClick={() => switchMode('signup')}>Create account</button> : null}
        {mode !== 'reset' ? <button type="button" className="link-button" onClick={() => switchMode('reset')}>Forgot password?</button> : null}
      </div>
    </section>
  )
}

export function RecoveryForm({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || pending) return
    setError('')
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setPending(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your password. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return <section className="auth-card relative z-10 w-full max-w-md rounded-[2rem] border border-[#a17a9d3d] bg-[#241a2bbb] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8" aria-labelledby="recovery-title">
    <h2 id="recovery-title" className="font-serif text-3xl tracking-tight">Choose a new password</h2>
    <p className="mt-2 text-sm text-[#c9bfd0]">Use a new password with at least 8 characters.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block space-y-2 text-sm text-[#e1d3e7]"><span>New password</span><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label className="block space-y-2 text-sm text-[#e1d3e7]"><span>Confirm new password</span><input className={inputClass} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
      {error ? <p role="alert" className="rounded-xl bg-[#632f49] px-4 py-3 text-sm text-[#ffe4ed]">{error}</p> : null}
      <button className={buttonClass} type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save new password'}</button>
    </form>
  </section>
}
