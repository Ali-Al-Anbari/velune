import { supabase } from '../lib/supabase'

export type WageProfile = {
  id: string
  user_id: string
  name: string
  hourly_wage_cents: number
  normally_tipped: boolean
  include_tips_in_tax_estimate: boolean
  estimated_withholding_bps: number | null
  is_default: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
}

export type WageProfileInput = Pick<WageProfile,
  'name' | 'hourly_wage_cents' | 'normally_tipped' |
  'include_tips_in_tax_estimate' | 'estimated_withholding_bps'>

export type Tip = {
  id: string
  shift_id: string
  amount_cents: number
  label: 'Cash' | 'Card' | 'Other' | null
  created_at: string
  updated_at: string
}

function client() {
  if (!supabase) throw new Error('Supabase is unavailable.')
  return supabase
}

export async function loadWageProfiles(userId: string): Promise<WageProfile[]> {
  const { data, error } = await client().from('wage_profiles').select('*').eq('user_id', userId)
    .order('is_archived', { ascending: true }).order('name')
  if (error) throw error
  return data as WageProfile[]
}

export async function createWageProfile(userId: string, input: WageProfileInput): Promise<WageProfile> {
  const { data, error } = await client().from('wage_profiles')
    .insert({ id: crypto.randomUUID(), user_id: userId, ...input }).select('*').single()
  if (error) throw error
  return data as WageProfile
}

export async function updateWageProfile(userId: string, id: string, input: WageProfileInput): Promise<WageProfile> {
  const { data, error } = await client().from('wage_profiles').update(input)
    .eq('id', id).eq('user_id', userId).select('*').single()
  if (error) throw error
  return data as WageProfile
}

export async function archiveWageProfile(userId: string, id: string): Promise<void> {
  const { data, error } = await client().from('wage_profiles')
    .update({ is_archived: true, is_default: false }).eq('id', id).eq('user_id', userId).select('id').single()
  if (error) throw error
  if (!data) throw new Error('Wage profile not found.')
}

export async function setDefaultWageProfile(id: string): Promise<void> {
  const { error } = await client().rpc('set_default_wage_profile', { p_profile_id: id })
  if (error) throw error
}

export async function createTip(tip: Pick<Tip, 'id' | 'shift_id' | 'amount_cents' | 'label'>): Promise<Tip> {
  const { data, error } = await client().from('tips').insert(tip).select('*').single()
  if (!error) return data as Tip
  if (error.code !== '23505') throw error
  const { data: existing, error: lookupError } = await client().from('tips')
    .select('*').eq('id', tip.id).single()
  if (lookupError) throw lookupError
  if (existing.shift_id !== tip.shift_id || existing.amount_cents !== tip.amount_cents || existing.label !== tip.label) {
    throw new Error('This tip request ID was already used for a different tip.')
  }
  return existing as Tip
}

export async function updateTip(shiftId: string, tipId: string, amountCents: number, label: Tip['label']): Promise<Tip> {
  const { data, error } = await client().from('tips').update({ amount_cents: amountCents, label })
    .eq('id', tipId).eq('shift_id', shiftId).select('*').single()
  if (error) throw error
  return data as Tip
}

export async function deleteTip(shiftId: string, tipId: string): Promise<void> {
  const { data, error } = await client().from('tips').delete()
    .eq('id', tipId).eq('shift_id', shiftId).select('id').single()
  if (error) throw error
  if (!data) throw new Error('Tip not found.')
}
