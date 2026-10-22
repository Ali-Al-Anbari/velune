import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { loadShift, loadShiftHistoryPage, type ShiftHistoryCursor, type ShiftHistoryFilters } from './api'
import { type ShiftRecord } from './time'
import { ShiftHistoryItem } from './ShiftHistoryItem'
import { loadWageProfiles, type WageProfile } from '../earnings/api'

const ManualShiftEditor = lazy(() => import('./ManualShiftEditor').then((module) => ({ default: module.ManualShiftEditor })))
const panel = 'rounded-[1.5rem] border border-[#9b719a45] bg-[#261b2dbb] p-4 shadow-xl shadow-black/10 backdrop-blur-xl sm:p-5'
const control = 'min-h-11 w-full rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-2 text-sm text-[#f4eaf7] outline-none focus:border-[#e9a4bf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]'
const button = 'min-h-11 rounded-xl border border-[#b884a382] bg-[#3a2943a8] px-4 py-2.5 text-sm text-[#f4eaf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'

export function ShiftHistory({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [draft, setDraft] = useState<ShiftHistoryFilters>({ sort: 'newest' })
  const [applied, setApplied] = useState<ShiftHistoryFilters>({ sort: 'newest' })
  const [shifts, setShifts] = useState<ShiftRecord[]>([])
  const [profiles, setProfiles] = useState<WageProfile[]>([])
  const [cursors, setCursors] = useState<(ShiftHistoryCursor | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<ShiftHistoryCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorShift, setEditorShift] = useState<ShiftRecord | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [reload, setReload] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const requestNumber = useRef(0)
  const page = cursors.length - 1
  const cursor = cursors[page] ?? null

  useEffect(() => {
    let mounted = true
    loadWageProfiles(userId).then((items) => { if (mounted) setProfiles(items) }).catch(() => {
      if (mounted) setError('Could not load wage profiles for filtering. Shift history is still available.')
    })
    return () => { mounted = false }
  }, [userId])

  useEffect(() => {
    const currentRequest = ++requestNumber.current
    setLoading(true)
    setError('')
    loadShiftHistoryPage(userId, cursor, applied).then((result) => {
      if (requestNumber.current !== currentRequest) return
      setShifts(result.shifts)
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setNowMs(Date.now())
    }).catch((cause: unknown) => {
      if (requestNumber.current !== currentRequest) return
      const message = cause instanceof Error ? cause.message : ''
      setError(/^Choose a valid (start|end) date\.$|^Start date must be/.test(message) ? message : 'Could not load shift history. Please check your filters and try again.')
    }).finally(() => {
      if (requestNumber.current === currentRequest) setLoading(false)
    })
    return () => { requestNumber.current += 1 }
  }, [userId, page, cursor, applied, reload])

  const refreshShift = useCallback(async (shiftId: string) => {
    const updated = await loadShift(userId, shiftId)
    setShifts((previous) => previous.map((item) => item.id === shiftId ? updated : item))
  }, [userId])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setError('Start date must be on or before end date.')
      return
    }
    setError('')
    setApplied({ ...draft })
    setCursors([null])
  }

  function updateDraft<K extends keyof ShiftHistoryFilters>(key: K, value: ShiftHistoryFilters[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  async function editorSaved() {
    setEditorShift(null)
    setAddOpen(false)
    setCursors([null])
    setReload((value) => value + 1)
  }

  async function editorDeleted(shiftId: string) {
    setShifts((previous) => previous.filter((item) => item.id !== shiftId))
    setEditorShift(null)
    setReload((value) => value + 1)
  }

  return <section className="relative z-10 w-full py-8 sm:py-10" aria-labelledby="history-page-title">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><button type="button" className="link-button mb-2 text-sm" onClick={onBack}>← Shifts</button><h1 id="history-page-title" className="font-serif text-3xl tracking-tight sm:text-4xl">Shift history</h1><p className="mt-1 text-sm text-[#b9a9c4]">Search all completed shifts. Date filters use the local shift start date.</p></div>
      <button type="button" className="min-h-11 rounded-xl bg-[#e9a4bf] px-4 py-2.5 text-sm font-semibold text-[#241426] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]" onClick={() => setAddOpen(true)}>Add shift</button>
    </header>

    <form className={`${panel} mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`} onSubmit={applyFilters} aria-label="Filter shift history">
      <label className="text-xs text-[#c9bfd0] sm:col-span-2">Search profile name, shift date (YYYY-MM-DD), or shift ID<input className={`${control} mt-1`} type="search" value={draft.search ?? ''} onChange={(event) => updateDraft('search', event.target.value)} placeholder="Night shift or 2026-10-21" /></label>
      <label className="text-xs text-[#c9bfd0]">From date<input className={`${control} mt-1`} type="date" value={draft.startDate ?? ''} onChange={(event) => updateDraft('startDate', event.target.value)} /></label>
      <label className="text-xs text-[#c9bfd0]">Through date<input className={`${control} mt-1`} type="date" value={draft.endDate ?? ''} onChange={(event) => updateDraft('endDate', event.target.value)} /></label>
      <label className="text-xs text-[#c9bfd0]">Wage profile<select className={`${control} mt-1`} value={draft.wageProfileId ?? ''} onChange={(event) => updateDraft('wageProfileId', event.target.value || undefined)}><option value="">All profiles</option><option value="no-profile">No profile</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_archived ? ' · archived' : ''}</option>)}</select></label>
      <label className="text-xs text-[#c9bfd0]">Sort<select className={`${control} mt-1`} value={draft.sort ?? 'newest'} onChange={(event) => updateDraft('sort', event.target.value as NonNullable<ShiftHistoryFilters['sort']>)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="longest">Longest shift</option><option value="most-tips">Most tips</option><option value="highest-rate">Highest hourly rate</option></select></label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
        <label className="flex min-h-11 items-center gap-2 text-xs text-[#d8c8e2]"><input className="accent-[#e9a4bf]" type="checkbox" checked={Boolean(draft.withTipsOnly)} onChange={(event) => updateDraft('withTipsOnly', event.target.checked)} />Shifts with tips</label>
        <label className="flex min-h-11 items-center gap-2 text-xs text-[#d8c8e2]"><input className="accent-[#e9a4bf]" type="checkbox" checked={Boolean(draft.missingWageOnly)} onChange={(event) => updateDraft('missingWageOnly', event.target.checked)} />Missing wage snapshot</label>
      </div>
      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-2"><button type="button" className={button} onClick={() => { const empty: ShiftHistoryFilters = { sort: 'newest' }; setDraft(empty); setApplied(empty); setCursors([null]); setError('') }}>Clear</button><button className={`${button} border-[#e9a4bf77] bg-[#59384f]`} type="submit">Apply filters</button></div>
    </form>

    {error ? <p className="mb-4 rounded-xl border border-[#e9a4bf55] bg-[#512b43] p-3 text-sm text-[#ffe4ed]" role="alert">{error}</p> : null}
    {loading ? <div className={`${panel} py-10 text-center text-[#c9bfd0]`} role="status">Loading shift history…</div>
      : shifts.length === 0 ? <div className={`${panel} py-10 text-center`}><h2 className="font-serif text-2xl text-[#f4eaf7]">No matching shifts</h2><p className="mt-2 text-sm text-[#b9a9c4]">Try a different search or clear the filters.</p></div>
        : <><p className="mb-3 text-xs text-[#ac9bb7]">Page {page + 1} · {shifts.length} shifts</p><div className="space-y-3">{shifts.map((shift) => <ShiftHistoryItem key={shift.id} shift={shift} nowMs={nowMs} onChanged={() => refreshShift(shift.id)} onEdit={() => setEditorShift(shift)} />)}</div></>}

    <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Shift history pages"><button className={button} type="button" disabled={page === 0 || loading} onClick={() => { setCursors((previous) => previous.slice(0, -1)); setNextCursor(null) }}>Previous</button><span className="text-xs text-[#ac9bb7]">Page {page + 1}</span><button className={button} type="button" disabled={!hasMore || !nextCursor || loading} onClick={() => { if (nextCursor) setCursors((previous) => [...previous, nextCursor]) }}>Next</button></nav>

    {(editorShift || addOpen) ? <Suspense fallback={<p role="status" className="fixed inset-x-4 bottom-4 z-50 rounded-xl bg-[#33243d] p-4 text-sm text-[#f4eaf7]">Opening shift editor…</p>}><ManualShiftEditor shift={editorShift} profiles={profiles} onCancel={() => { setEditorShift(null); setAddOpen(false) }} onSaved={editorSaved} onDeleted={editorDeleted} /></Suspense> : null}
  </section>
}
