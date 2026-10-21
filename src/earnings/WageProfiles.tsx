import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { archiveWageProfile, createWageProfile, loadWageProfiles, setDefaultWageProfile, updateWageProfile, type WageProfile } from './api'
import { centsInput, formatCents, parsePositiveCents } from './money'

const panel = 'rounded-[1.75rem] border border-[#9b719a45] bg-[#261b2dbb] p-5 shadow-xl shadow-black/10 backdrop-blur-xl sm:p-6'
const button = 'rounded-2xl bg-[#e9a4bf] px-5 py-3 text-sm font-semibold text-[#241426] transition hover:bg-[#f2bfd2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55'
const field = 'mt-1.5 w-full rounded-xl border border-[#9b719a70] bg-[#1d1725] px-4 py-3 text-[#f4eaf7] outline-none focus:border-[#e9a4bf]'

export function WageProfiles({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [profiles, setProfiles] = useState<WageProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<WageProfile | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [wage, setWage] = useState('')
  const [normallyTipped, setNormallyTipped] = useState(false)
  const [makeDefault, setMakeDefault] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<WageProfile | null>(null)

  const reload = useCallback(async () => {
    const rows = await loadWageProfiles(userId)
    setProfiles(rows)
    setLoading(false)
  }, [userId])

  useEffect(() => { void reload().catch((cause) => { setError(cause instanceof Error ? cause.message : 'Could not load wage profiles.'); setLoading(false) }) }, [reload])

  function openCreate() {
    setEditing(null); setName(''); setWage(''); setNormallyTipped(false)
    setMakeDefault(!profiles.some((profile) => profile.is_default && !profile.is_archived))
    setError(''); setFormOpen(true)
  }

  function openEdit(profile: WageProfile) {
    setEditing(profile); setName(profile.name); setWage(centsInput(profile.hourly_wage_cents))
    setNormallyTipped(profile.normally_tipped)
    setMakeDefault(profile.is_default); setError(''); setFormOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    const cents = parsePositiveCents(wage)
    if (cleanName.length < 2 || cleanName.length > 80 || !/\S/.test(cleanName)) { setError('Enter a meaningful name, 2 to 80 characters.'); return }
    if (cents == null) { setError('Enter an hourly wage from $0.01 to $10,000.00.'); return }
    setBusy(true); setError(''); setNotice('')
    let profileSaved = false
    try {
      const input = { name: cleanName, hourly_wage_cents: cents, normally_tipped: normallyTipped }
      const saved = editing ? await updateWageProfile(userId, editing.id, input) : await createWageProfile(userId, input)
      profileSaved = true
      setEditing(saved)
      if (makeDefault && !saved.is_default) await setDefaultWageProfile(saved.id)
      await reload()
      setFormOpen(false)
      setNotice(editing ? 'Wage profile updated.' : 'Wage profile created.')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Could not save wage profile.'
      setError(profileSaved ? `Profile saved, but the default or refreshed list could not be confirmed: ${detail}` : detail)
      void reload().catch(() => {})
    } finally { setBusy(false) }
  }

  async function setDefault(profile: WageProfile) {
    setBusy(true); setError(''); setNotice('')
    try { await setDefaultWageProfile(profile.id); await reload(); setNotice(`${profile.name} is now the default.`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not set default.'); void reload().catch(() => {}) }
    finally { setBusy(false) }
  }

  async function archive() {
    if (!archiveTarget) return
    setBusy(true); setError(''); setNotice('')
    try { await archiveWageProfile(userId, archiveTarget.id); await reload(); setArchiveTarget(null); setNotice('Wage profile archived.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive profile.') }
    finally { setBusy(false) }
  }

  const active = profiles.filter((profile) => !profile.is_archived)
  const archived = profiles.filter((profile) => profile.is_archived)

  return <div className="relative z-10 w-full py-12 sm:py-16">
    <button type="button" className="link-button text-sm" onClick={onBack}>← Back to shifts</button>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Wage Profiles</h1><p className="mt-2 text-sm text-[#c9bfd0]">Save the pay settings you use for each kind of shift.</p></div>
      <button type="button" className={button} disabled={busy} onClick={openCreate}>New profile</button>
    </div>
    {notice ? <p role="status" className="mt-5 rounded-xl bg-[#46314d] p-3 text-sm">{notice}</p> : null}
    {error && !archiveTarget ? <div role="alert" className="mt-5 rounded-xl bg-[#512b43] p-3 text-sm text-[#ffe4ed]">{error}<button type="button" className="link-button ml-3" onClick={() => void reload().then(() => setError('')).catch(() => {})}>Refresh list</button></div> : null}
    {loading ? <p role="status" className="mt-6 text-[#c9bfd0]">Loading wage profiles…</p> : null}

    {formOpen ? <form onSubmit={(event) => void save(event)} className={`${panel} mt-6 space-y-4`} aria-label={editing ? 'Edit wage profile' : 'Create wage profile'}>
      <h2 className="font-serif text-2xl">{editing ? 'Edit profile' : 'New profile'}</h2>
      <label className="block text-sm text-[#d9cde0]">Profile name<input className={field} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Day Shift" required /></label>
      <label className="block text-sm text-[#d9cde0]">Hourly wage ($)<input className={field} type="text" inputMode="decimal" value={wage} onChange={(event) => setWage(event.target.value)} placeholder="18.50" required /></label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[#e9a4bf]" checked={normallyTipped} onChange={(event) => setNormallyTipped(event.target.checked)} />This job normally receives tips</label>
      {!editing?.is_default ? <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[#e9a4bf]" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />Make default for new shifts</label> : null}
      <div className="flex flex-wrap gap-3"><button type="submit" className={button} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="link-button" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</button></div>
    </form> : null}

    <section className="mt-8" aria-labelledby="active-profiles-title"><h2 id="active-profiles-title" className="font-serif text-2xl">Active profiles</h2>
      {active.length === 0 && !loading && !error ? <p className={`${panel} mt-3 text-sm text-[#c9bfd0]`}>No wage profiles yet. Add one to save your pay settings.</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{active.map((profile) => <article key={profile.id} className={panel}>
        <div className="flex items-start justify-between gap-3"><h3 className="font-serif text-xl">{profile.name}</h3>{profile.is_default ? <span className="rounded-full bg-[#70465e] px-2.5 py-1 text-xs text-[#f4dce9]">Default</span> : null}</div>
        <p className="mt-2 text-2xl tabular-nums text-[#f4dce9]">{formatCents(profile.hourly_wage_cents)}<span className="ml-1 text-sm text-[#c9bfd0]">/ hour</span></p>
        <p className="mt-2 text-xs text-[#c9bfd0]">{profile.normally_tipped ? 'Normally tipped' : 'Tips optional'}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm"><button type="button" className="link-button" disabled={busy} onClick={() => openEdit(profile)}>Edit</button>{!profile.is_default ? <button type="button" className="link-button" disabled={busy} onClick={() => void setDefault(profile)}>Set default</button> : null}<button type="button" className="link-button" disabled={busy} onClick={() => setArchiveTarget(profile)}>Archive</button></div>
      </article>)}</div>
    </section>
    {archived.length > 0 ? <section className="mt-8" aria-labelledby="archived-profiles-title"><h2 id="archived-profiles-title" className="font-serif text-2xl">Archived profiles</h2><div className="mt-3 space-y-2">{archived.map((profile) => <p key={profile.id} className="rounded-xl border border-[#9b719a30] px-4 py-3 text-sm text-[#ac9bb7]">{profile.name} · {formatCents(profile.hourly_wage_cents)}/hour</p>)}</div></section> : null}

    {archiveTarget ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090711cc] px-6"><section role="dialog" aria-modal="true" aria-labelledby="archive-title" className={`${panel} w-full max-w-md`}><h2 id="archive-title" className="font-serif text-2xl">Archive {archiveTarget.name}?</h2><p className="mt-2 text-sm text-[#c9bfd0]">Past shifts keep their saved pay settings. This profile will no longer appear when starting a shift.</p>{error ? <p role="alert" className="mt-3 text-sm text-[#f3b2ca]">{error}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={() => void archive()}>{busy ? 'Archiving…' : 'Archive profile'}</button><button type="button" className="link-button" disabled={busy} onClick={() => setArchiveTarget(null)}>Cancel</button></div></section></div> : null}
  </div>
}
