import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function isSecretKey(value: string | undefined) {
  if (!value) return false
  if (value.startsWith('sb_secret_')) return true
  try {
    const payload = value.split('.')[1]
    return payload ? JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role' : false
  } catch {
    return false
  }
}

function validProjectUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

export const supabaseConfigError = !validProjectUrl(url) || !key || isSecretKey(key)
  ? import.meta.env.DEV
    ? 'Supabase is not configured. Add a valid VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart Vite. Never use a secret or service-role key.'
    : 'Velune is temporarily unavailable. Please try again later.'
  : null

// One browser client owns session persistence and redirect processing.
export const supabase: SupabaseClient | null = supabaseConfigError
  ? null
  : createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    })
