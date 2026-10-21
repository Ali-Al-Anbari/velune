import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { isAuthSessionMissingError, type User } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from '../lib/supabase'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'signedOut'; message?: string }
  | { kind: 'signedIn'; user: User }

const AuthContext = createContext<AuthState>({ kind: 'loading' })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => supabaseConfigError
    ? { kind: 'unavailable', message: supabaseConfigError }
    : { kind: 'loading' })

  useEffect(() => {
    if (!supabase) return
    let active = true
    let ready = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || !ready) return
      if (event === 'SIGNED_OUT') setState({ kind: 'signedOut' })
      if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event) && session?.user) {
        setState({ kind: 'signedIn', user: session.user })
      }
    })

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      ready = true
      setState(error && !isAuthSessionMissingError(error)
        ? { kind: 'signedOut', message: 'Could not restore your session. Please sign in again.' }
        : data.user ? { kind: 'signedIn', user: data.user } : { kind: 'signedOut' })
    }).catch(() => {
      if (!active) return
      ready = true
      setState({ kind: 'signedOut', message: 'Could not restore your session. Please sign in again.' })
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

// This hook intentionally shares the provider's private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
