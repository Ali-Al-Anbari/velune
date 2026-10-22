import { useEffect, useState, type ReactNode } from 'react'
import { AuthForm, RecoveryForm } from './auth/AuthForm'
import { AuthProvider, useAuth } from './auth/session'
import { supabase } from './lib/supabase'
import { ShiftLogger } from './shift/ShiftLogger'
import { WageProfiles } from './earnings/WageProfiles'
import { EarningsReports } from './earnings/EarningsReports'
import { ShiftHistory } from './shift/ShiftHistory'

function redirectFailed() {
  const query = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  return Boolean(query.get('error') || query.get('error_code') || fragment.get('error') || fragment.get('error_code'))
}

function Orb() {
  return <div className="art-stage pointer-events-none absolute inset-0 opacity-50 lg:opacity-70" aria-hidden="true">
    <div className="orb-glow" /><div className="orb" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-dot" />
  </div>
}

function Shell({ children, action, navigation }: { children: ReactNode; action?: ReactNode; navigation?: ReactNode }) {
  return <main className="landing-shell min-h-svh overflow-x-clip text-[#f4eaf7]">
    <div className={`landing-inner mx-auto flex min-h-svh w-full max-w-6xl flex-col px-7 sm:px-12 lg:px-16 ${navigation ? 'pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] lg:pb-0' : ''}`}>
      <header className="app-header flex flex-wrap items-center justify-between gap-3">
        <span className="brand-mark">velune</span>{action}
      </header>
      {children}
      <footer className="pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-8 text-sm text-[#b6a4bd] sm:pb-10">Hey Shaudi!!</footer>
    </div>
    {navigation}
  </main>
}

const destinations = [
  { label: 'Shifts', path: '/app', icon: <><path d="M8 3v3m8-3v3M4.5 9h15" /><rect x="3.5" y="5" width="17" height="16" rx="3" /></> },
  { label: 'History', path: '/app/history', icon: <><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="18" cy="17" r="3" /></> },
  { label: 'Earnings', path: '/app/reports', icon: <><path d="M4 19V5m0 14h16" /><path d="m7 15 4-4 3 2 5-6" /></> },
  { label: 'Profiles', path: '/app/profiles', icon: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.5-3.4 3.2-5.5 7-5.5s6.5 2.1 7 5.5" /></> },
]

function AppNavigation({ path, navigate, mobile = false }: { path: string; navigate: (path: string) => void; mobile?: boolean }) {
  return <nav aria-label="Main navigation" className={mobile
    ? 'app-bottom-nav fixed inset-x-0 z-40 mx-auto flex w-[min(24rem,calc(100vw-2rem))] items-center justify-between rounded-[1.35rem] border border-[#b48ab346] bg-[#211827ed] p-1.5 shadow-[0_12px_36px_#09070db3] backdrop-blur-xl lg:hidden'
    : 'hidden items-center gap-1 rounded-full border border-[#b48ab344] bg-[#241a2bbb] p-1 shadow-inner shadow-white/[.03] backdrop-blur-xl lg:flex'}>
    {destinations.map(({ label, path: destination, icon }) => {
      const active = path === destination || (destination === '/app' && path === '/app/')
      return <button
        key={destination}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        onClick={() => navigate(destination)}
        className={mobile
          ? `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1rem] px-1 text-[.67rem] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] ${active ? 'bg-[#6c5278a8] text-[#fff2fa]' : 'text-[#c4b4cd] hover:bg-[#47365080]'}`
          : `flex min-h-10 items-center gap-2 rounded-full px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] ${active ? 'bg-[#6c5278a8] text-[#fff2fa]' : 'text-[#c4b4cd] hover:bg-[#47365080]'}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={mobile ? 'h-[1.2rem] w-[1.2rem]' : 'h-4 w-4'}>{icon}</svg>
        <span>{label}</span>
      </button>
    })}
  </nav>
}

function CenterCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="auth-card relative z-10 w-full max-w-md rounded-[2rem] border border-[#a17a9d3d] bg-[#241a2bbb] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8" aria-labelledby="status-title">
    <h1 id="status-title" className="font-serif text-3xl tracking-tight">{title}</h1>
    <div className="mt-3 text-base leading-relaxed text-[#c9bfd0]">{children}</div>
  </section>
}

function AppContent() {
  const auth = useAuth()
  const [path, setPath] = useState(window.location.pathname)
  const [linkError] = useState(redirectFailed)
  const [signOutPending, setSignOutPending] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [resetComplete, setResetComplete] = useState(false)

  function navigate(next: string) {
    window.history.pushState(null, '', next)
    setPath(next)
  }

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (auth.kind === 'loading' || auth.kind === 'unavailable') return
    if (path === '/auth/callback' || path === '/auth/recovery') {
      // Supabase has processed the fragment by this point. Remove tokens/errors from browser history.
      window.history.replaceState(null, '', path)
    }
    if (path === '/' && auth.kind === 'signedIn' && auth.user.email_confirmed_at) navigate('/app')
  }, [auth, path])

  async function signOut() {
    if (!supabase) return
    setSignOutPending(true)
    setSignOutError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) setSignOutError(error.message)
      else navigate('/')
    } catch {
      setSignOutError('Could not sign out. Please try again.')
    } finally {
      setSignOutPending(false)
    }
  }

  if (auth.kind === 'unavailable') return <Shell><div className="flex flex-1 items-center"><CenterCard title="Setup needed"><p role="alert">{auth.message}</p></CenterCard></div></Shell>
  if (auth.kind === 'loading') return <Shell><div className="flex flex-1 items-center"><p role="status" className="text-[#c9bfd0]">Opening your space…</p></div></Shell>

  const callback = path === '/auth/callback'
  const recovery = path === '/auth/recovery'
  if (callback || recovery) {
    return <Shell><div className="relative flex flex-1 items-center justify-center py-16"><div className="absolute inset-0 mx-auto w-full max-w-xl"><Orb /></div>
      {linkError ? <CenterCard title="Link unavailable"><p>This link is invalid or has expired. Request a new link and try again.</p><button type="button" className="link-button mt-5" onClick={() => navigate('/')}>Back to sign in</button></CenterCard>
        : callback ? <CenterCard title={auth.kind === 'signedIn' && auth.user.email_confirmed_at ? 'Email confirmed' : 'Confirmation pending'}>
            <p>{auth.kind === 'signedIn' && auth.user.email_confirmed_at ? 'Your email is verified. Your space is ready.' : 'We could not confirm this link. Try signing in, or request a new verification email.'}</p>
            <button type="button" className="link-button mt-5" onClick={() => navigate(auth.kind === 'signedIn' && auth.user.email_confirmed_at ? '/app' : '/')}>Continue</button>
          </CenterCard>
        : resetComplete ? <CenterCard title="Password updated"><p>Your password has changed. Sign in with your new password.</p><button type="button" className="link-button mt-5" onClick={() => navigate('/')}>Go to sign in</button></CenterCard>
          : auth.kind === 'signedIn' ? <RecoveryForm onComplete={() => setResetComplete(true)} />
            : <CenterCard title="Recovery link unavailable"><p>Request a new password reset link to continue.</p><button type="button" className="link-button mt-5" onClick={() => navigate('/')}>Back to sign in</button></CenterCard>}
    </div></Shell>
  }

  if (auth.kind === 'signedIn' && !auth.user.email_confirmed_at) {
    return <Shell action={<button type="button" className="link-button" onClick={signOut} disabled={signOutPending}>Sign out</button>}>
      <div className="flex flex-1 items-center py-16"><CenterCard title="Verify your email"><p>Open the verification link we sent to your email before continuing.</p>{signOutError ? <p role="alert" className="mt-4 text-[#f3b2ca]">{signOutError}</p> : null}</CenterCard></div>
    </Shell>
  }

  if (auth.kind === 'signedIn') {
    return <Shell navigation={<AppNavigation path={path} navigate={navigate} mobile />} action={<div className="flex items-center gap-3 sm:gap-4">
      <AppNavigation path={path} navigate={navigate} />
      <button type="button" className="link-button text-xs sm:text-sm" onClick={signOut} disabled={signOutPending}>{signOutPending ? 'Signing out…' : 'Sign out'}</button>
    </div>}>
      {signOutError ? <p role="alert" className="mt-6 text-[#f3b2ca]">{signOutError}</p> : null}
      {path === '/app/profiles' ? <WageProfiles key={auth.user.id} userId={auth.user.id} onBack={() => navigate('/app')} />
        : path === '/app/reports' ? <EarningsReports key={auth.user.id} userId={auth.user.id} />
          : path === '/app/history' ? <ShiftHistory key={auth.user.id} userId={auth.user.id} onBack={() => navigate('/app')} />
            : <ShiftLogger key={auth.user.id} userId={auth.user.id} onViewAll={() => navigate('/app/history')} />}
    </Shell>
  }

  return <Shell><section className="relative flex flex-1 flex-col gap-10 py-14 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16" aria-labelledby="hero-title">
    <div className="hero-copy relative z-10 self-center lg:self-auto"><h1 id="hero-title" className="hero-title max-w-[10ch] text-[clamp(3.7rem,13.2vw,7.6rem)] leading-[0.94] tracking-[-0.055em] lg:max-w-none lg:text-[clamp(4.5rem,6.3vw,6rem)]">Make room<br />for what <em>matters.</em></h1>
      <p className="mt-7 max-w-[29rem] text-lg leading-relaxed text-[#c9bfd0] sm:text-xl">A calmer way to keep your shifts and earnings in view. Coming soon.</p>
    </div>
    <div className="relative flex items-center justify-center pb-8 lg:pb-0"><div className="absolute inset-0 translate-x-20 translate-y-8 lg:translate-x-28 lg:translate-y-16"><Orb /></div><AuthForm initialMessage={auth.message} onSignedIn={() => navigate('/app')} /></div>
  </section></Shell>
}

function App() {
  return <AuthProvider><AppContent /></AuthProvider>
}

export default App
