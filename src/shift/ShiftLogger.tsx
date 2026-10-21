import { useCallback, useEffect, useRef, useState } from 'react'
import { beginBreak, endBreak, endShift, loadShift, loadShiftPage, loadShiftSnapshot, startShift } from './api'
import { formatDuration, formatLocalDate, formatLocalTime, shiftTotals, type ShiftRecord } from './time'
import { loadWageProfiles, type WageProfile } from '../earnings/api'
import { TipsEditor } from '../earnings/TipsEditor'
import { centsInput, formatCents, parsePositiveCents } from '../earnings/money'

const panel = 'rounded-[1.75rem] border border-[#9b719a45] bg-[#261b2dbb] shadow-xl shadow-black/10 backdrop-blur-xl'
const primaryButton = 'rounded-2xl bg-[#e9a4bf] px-6 py-3.5 text-base font-semibold text-[#241426] transition hover:bg-[#f2bfd2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'
const secondaryButton = 'rounded-2xl border border-[#b884a382] bg-[#3a2943a8] px-5 py-3.5 text-base font-medium text-[#f4eaf7] transition hover:bg-[#513550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={`${panel} px-4 py-4 sm:px-5`}><dt className="text-sm text-[#c9bfd0]">{label}</dt><dd className="mt-2 font-serif text-2xl text-[#f4eaf7] tabular-nums sm:text-3xl">{value}</dd></div>
}

function BreakTime({ paidMs, unpaidMs, active, id }: { paidMs: number; unpaidMs: number; active?: { isPaid: boolean; durationMs: number } | null; id: string }) {
  const total = paidMs + unpaidMs
  const hasBreaks = total > 0 || active != null
  return <section aria-labelledby={id} className={`${panel} p-5 sm:p-6`}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-serif text-xl text-[#f4eaf7]">Break Time</h2>
      <p className="font-serif text-2xl tabular-nums text-[#f4dce9]">{formatDuration(total)}</p>
    </div>
    {active ? <p role="status" className="mt-2 text-sm text-[#e9a4bf]">On an {active.isPaid ? 'paid' : 'unpaid'} break · {formatDuration(active.durationMs)} so far</p> : null}
    {hasBreaks ? <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {paidMs > 0 ? <span className="rounded-full bg-[#6a435b80] px-3 py-1.5 text-[#f4c6d9]">Paid · {formatDuration(paidMs)}</span> : null}
      {unpaidMs > 0 ? <span className="rounded-full bg-[#493b5580] px-3 py-1.5 text-[#d8c8e2]">Unpaid · {formatDuration(unpaidMs)}</span> : null}
    </div> : <p className="mt-2 text-sm text-[#ac9bb7]">No breaks yet</p>}
  </section>
}

function HistoryItem({ shift, nowMs, onChanged, highlighted = false }: { shift: ShiftRecord; nowMs: number; onChanged: () => Promise<void>; highlighted?: boolean }) {
  const totals = shiftTotals(shift, nowMs)
  return <article className={`${panel} p-5 sm:p-6 ${highlighted ? 'border-[#e9a4bf99]' : ''}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-serif text-xl text-[#f4eaf7]">{formatLocalDate(shift.started_at)}</h3>
      {highlighted ? <span className="text-sm text-[#e9a4bf]">Just saved</span> : null}
    </div>
    <p className="mt-1 text-sm text-[#c9bfd0]">{formatLocalTime(shift.started_at)} – {shift.ended_at ? `${formatLocalTime(shift.ended_at)}${formatLocalDate(shift.started_at) !== formatLocalDate(shift.ended_at) ? ` · ${formatLocalDate(shift.ended_at)}` : ''}` : 'In progress'} · local time</p>
    <p className="mt-2 text-xs text-[#c9bfd0]">{shift.wage_profile_name_snapshot ?? 'No wage profile'}{shift.hourly_wage_cents_snapshot != null ? ` · ${formatCents(shift.hourly_wage_cents_snapshot)}/hour${shift.hourly_wage_override_cents != null ? ' override' : ''}` : ''}</p>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#9b719a30] pt-4 text-sm">
      <div><dt className="text-[#ac9bb7]">Elapsed</dt><dd className="mt-1 tabular-nums">{formatDuration(totals.elapsedMs)}</dd></div>
      <div><dt className="text-[#ac9bb7]">Worked</dt><dd className="mt-1 tabular-nums">{formatDuration(totals.workedMs)}</dd></div>
    </dl>
    <div className="mt-4"><BreakTime id={`break-time-${highlighted ? 'completed-' : ''}${shift.id}`} paidMs={totals.paidBreakMs} unpaidMs={totals.unpaidBreakMs} /></div>
    <TipsEditor shift={shift} onChanged={onChanged} />
  </article>
}

export function ShiftLogger({ userId }: { userId: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [active, setActive] = useState<ShiftRecord | null>(null)
  const [history, setHistory] = useState<ShiftRecord[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [paidBreak, setPaidBreak] = useState(false)
  const [completedId, setCompletedId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<WageProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [wageOverride, setWageOverride] = useState('')
  const profileChoiceTouched = useRef(false)
  const startRequest = useRef<{ id: string; profileId: string | null; overrideCents: number | null } | null>(null)
  const breakRequest = useRef<{ id: string; paid: boolean } | null>(null)
  const loadVersion = useRef(0)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const [shiftResult, profileResult] = await Promise.allSettled([loadShiftSnapshot(userId), loadWageProfiles(userId)])
      if (version !== loadVersion.current) return
      if (shiftResult.status === 'rejected') throw shiftResult.reason
      const snapshot = shiftResult.value
      setActive(snapshot.active)
      setHistory(snapshot.shifts)
      setHasMore(snapshot.hasMore)
      if (profileResult.status === 'fulfilled') {
        const wageProfiles = profileResult.value
        setProfiles(wageProfiles)
        setSelectedProfileId((previous) => {
          if (profileChoiceTouched.current && (previous === null || wageProfiles.some((profile) => profile.id === previous && !profile.is_archived))) return previous
          return wageProfiles.find((profile) => profile.is_default && !profile.is_archived)?.id ?? null
        })
        setProfileError('')
      } else setProfileError('Could not load wage profiles. Refresh before starting a shift.')
      setLoadError('')
      if (snapshot.active) startRequest.current = null
      if (snapshot.active?.breaks.some((item) => !item.ended_at)) breakRequest.current = null
      setNowMs(Date.now())
    } catch (cause) {
      if (version === loadVersion.current) setLoadError(cause instanceof Error ? cause.message : 'Could not load your shifts. Check your connection and retry.')
      throw cause
    }
  }, [userId])

  const refreshTipShift = useCallback(async (shiftId: string) => {
    const updated = await loadShift(userId, shiftId)
    setActive((previous) => previous?.id === shiftId ? updated : previous)
    setHistory((previous) => previous.map((shift) => shift.id === shiftId ? updated : shift))
  }, [userId])

  useEffect(() => {
    void refresh().catch(() => {}).finally(() => setInitialLoading(false))
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000)
    const resume = () => {
      setNowMs(Date.now())
      if (document.visibilityState === 'visible') void refresh().catch(() => {})
    }
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [refresh])

  async function perform(label: string, action: () => Promise<unknown>, success: string) {
    if (busyRef.current || loadError) return
    if (!navigator.onLine) {
      setActionError('You are offline. Nothing was saved. Reconnect and retry. The same request ID will be reused.')
      return
    }
    busyRef.current = true
    setBusy(label)
    setActionError('')
    setNotice('')
    let saved = false
    try {
      await action()
      saved = true
      await refresh()
      setNotice(success)
    } catch (cause) {
      if (saved) {
        setActionError('Saved, but the latest state could not be loaded. Refresh your shifts before another action.')
      } else {
        const detail = cause instanceof Error ? cause.message : 'Network error'
        setActionError(`Could not confirm the action: ${detail}. Refresh to check its state, or retry with the same request ID.`)
        void refresh().catch(() => {})
      }
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  function start() {
    const overrideCents = wageOverride.trim() === '' ? null : parsePositiveCents(wageOverride)
    if (wageOverride.trim() !== '' && overrideCents === null) {
      setActionError('Enter an hourly wage override from $0.01 to $10,000.00.')
      return
    }
    const request = startRequest.current ?? { id: crypto.randomUUID(), profileId: selectedProfileId, overrideCents }
    startRequest.current = request
    void perform('start', async () => {
      await startShift(request.id, request.profileId, request.overrideCents)
      startRequest.current = null
    }, 'Shift started and saved.')
  }

  function startBreak(paid: boolean) {
    if (!active) return
    const request = breakRequest.current ?? { id: crypto.randomUUID(), paid }
    breakRequest.current = request
    void perform('break', async () => {
      await beginBreak(active.id, request.id, request.paid)
      breakRequest.current = null
      setPaidBreak(false)
    }, 'Break started and saved.')
  }

  function finishBreak() {
    if (!active) return
    const currentBreak = active.breaks.find((item) => !item.ended_at)
    if (currentBreak) void perform('endBreak', () => endBreak(active.id, currentBreak.id), 'Break ended and saved.')
  }

  function finishShift() {
    if (!active) return
    const id = active.id
    setConfirmEnd(false)
    void perform('endShift', async () => {
      await endShift(id)
      setCompletedId(id)
    }, 'Shift ended and saved.')
  }

  async function moreHistory() {
    if (historyBusy) return
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const page = await loadShiftPage(userId, history.length)
      setHistory((previous) => [...previous, ...page.shifts.filter((item) => !previous.some((old) => old.id === item.id))])
      setHasMore(page.hasMore)
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Could not load more shifts.')
    } finally {
      setHistoryBusy(false)
    }
  }

  const activeBreak = active?.breaks.find((item) => !item.ended_at)
  const totals = active ? shiftTotals(active, nowMs) : null
  const completed = history.find((item) => item.id === completedId)
  const controlsDisabled = Boolean(busy || loadError)

  return <div className="relative z-10 w-full py-12 sm:py-16" aria-label="Shift logger">
    {initialLoading ? <p role="status" className="text-[#c9bfd0]">Loading your shifts…</p> : null}
    {loadError ? <div role="alert" className={`${panel} mb-6 p-5 text-[#f5dce8]`}><p>Could not refresh your shifts: {loadError}</p><button type="button" className="link-button mt-3" onClick={() => void refresh().catch(() => {})}>Retry loading</button></div> : null}
    {profileError ? <div role="alert" className="mb-6 rounded-2xl border border-[#e9a4bf55] bg-[#512b43] p-4 text-sm text-[#ffe4ed]">{profileError}<button type="button" className="link-button ml-3" onClick={() => void refresh().catch(() => {})}>Retry</button></div> : null}
    {actionError ? <div role="alert" className="mb-6 rounded-2xl border border-[#e9a4bf55] bg-[#512b43] p-4 text-sm text-[#ffe4ed]"><p>{actionError}</p><button type="button" className="link-button mt-2" onClick={() => void refresh().catch(() => {})}>Refresh state</button></div> : null}
    {notice ? <p role="status" className="mb-6 rounded-2xl bg-[#46314d] p-4 text-sm text-[#f4eaf7]">{notice}</p> : null}

    {!initialLoading && !loadError ? <>
      {active ? <section aria-labelledby="current-shift-title">
        <h1 id="current-shift-title" className="font-serif text-4xl tracking-tight text-[#f4eaf7] sm:text-5xl">Current shift</h1>
        <div className={`${panel} relative mt-6 overflow-hidden p-6 sm:p-8`}>
          <div className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full border border-[#bd83aa55] bg-[radial-gradient(circle_at_30%_70%,#8d587966,transparent_65%)]" aria-hidden="true" />
          <p className="relative text-sm text-[#c9bfd0]">Elapsed time</p>
          <p className="relative mt-2 font-serif text-[clamp(3.5rem,14vw,6rem)] leading-none tracking-[-0.04em] text-[#f4dce9] tabular-nums" aria-live="off">{formatDuration(totals!.elapsedMs)}</p>
          <p className="relative mt-5 text-sm text-[#c9bfd0]">Started {formatLocalDate(active.started_at)} at {formatLocalTime(active.started_at)} · local time</p>
          <p className="relative mt-2 text-sm text-[#f4dce9]">{active.wage_profile_name_snapshot ?? 'No wage profile'}{active.hourly_wage_cents_snapshot != null ? ` · ${formatCents(active.hourly_wage_cents_snapshot)}/hour${active.hourly_wage_override_cents != null ? ' override' : ''}` : ''}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="Worked time" value={formatDuration(totals!.workedMs)} />
          <BreakTime id="break-time-current" paidMs={totals!.paidBreakMs} unpaidMs={totals!.unpaidBreakMs} active={activeBreak ? { isPaid: activeBreak.is_paid, durationMs: Math.max(0, nowMs - Date.parse(activeBreak.started_at)) } : null} />
        </div>
        <div className={`${panel} mt-4 p-5 sm:p-6 ${activeBreak ? 'border-[#e9a4bf88] bg-[#3a2437c9]' : ''}`}>
          {activeBreak ? <div className="flex flex-col gap-3 sm:flex-row"><button type="button" className={secondaryButton} disabled={controlsDisabled} onClick={finishBreak}>{busy === 'endBreak' ? 'Saving…' : 'End break'}</button><button type="button" className={primaryButton} disabled={controlsDisabled} onClick={() => setConfirmEnd(true)}>End shift</button></div>
            : <><h2 className="font-serif text-2xl">Take a break</h2><p className="mt-1 text-sm text-[#c9bfd0]">Unpaid by default. Turn on Paid break to count this time as worked.</p>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-[#9b719a45] bg-[#20172880] px-4 py-3">
                <label htmlFor="paid-break-toggle" className="text-sm font-medium text-[#f4eaf7]">Paid break</label>
                <button id="paid-break-toggle" type="button" role="switch" aria-checked={paidBreak} disabled={controlsDisabled} onClick={() => setPaidBreak((value) => !value)} className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55 ${paidBreak ? 'bg-[#d88eae]' : 'bg-[#58485e]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-[#fff5fa] shadow transition-all ${paidBreak ? 'left-6' : 'left-1'}`} /></button>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row"><button type="button" className={secondaryButton} disabled={controlsDisabled || (breakRequest.current !== null && breakRequest.current.paid !== paidBreak)} onClick={() => startBreak(paidBreak)}>{busy === 'break' ? 'Saving…' : breakRequest.current ? `Retry ${breakRequest.current.paid ? 'paid' : 'unpaid'} break` : 'Start break'}</button><button type="button" className={primaryButton} disabled={controlsDisabled} onClick={() => setConfirmEnd(true)}>End shift</button></div>
            </>}
        </div>
        <div className={`${panel} mt-4 p-5 sm:p-6`}><TipsEditor shift={active} onChanged={() => refreshTipShift(active.id)} /></div>
      </section> : <section aria-labelledby="ready-title"><h1 id="ready-title" className="font-serif text-4xl tracking-tight sm:text-5xl">Ready when you are.</h1>
        <div className={`${panel} relative mt-6 overflow-hidden p-7 sm:p-9`}><div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border border-[#bd83aa55] bg-[radial-gradient(circle_at_30%_70%,#8d587966,transparent_65%)]" aria-hidden="true" />
          <p className="relative font-serif text-2xl text-[#f4dce9]">Start a shift to begin tracking your time.</p>
          <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-[#c9bfd0]">Wage profile<select className="mt-1.5 w-full rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-3 text-[#f4eaf7]" value={selectedProfileId ?? ''} disabled={controlsDisabled || startRequest.current !== null} onChange={(event) => { profileChoiceTouched.current = true; setSelectedProfileId(event.target.value || null) }}><option value="">No profile</option>{profiles.filter((profile) => !profile.is_archived).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.is_default ? ' · default' : ''}</option>)}</select></label>
            <label className="text-sm text-[#c9bfd0]">Hourly wage override ($) · optional<input className="mt-1.5 w-full rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-3 text-[#f4eaf7]" type="text" inputMode="decimal" value={wageOverride} disabled={controlsDisabled || startRequest.current !== null} onChange={(event) => setWageOverride(event.target.value)} placeholder={centsInput(profiles.find((profile) => profile.id === selectedProfileId)?.hourly_wage_cents ?? null) || '18.50'} /></label>
          </div>
          <button type="button" className={`${primaryButton} relative mt-6 w-full sm:w-auto`} disabled={controlsDisabled || Boolean(profileError)} onClick={start}>{busy === 'start' ? 'Saving…' : startRequest.current ? 'Retry start shift' : 'Start shift'}</button>
        </div>
      </section>}

      {completed ? <section className="mt-10" aria-labelledby="completed-title"><h2 id="completed-title" className="mb-4 font-serif text-3xl">Completed shift summary</h2><HistoryItem shift={completed} nowMs={nowMs} onChanged={() => refreshTipShift(completed.id)} highlighted /></section> : null}
      <section className="mt-12" aria-labelledby="history-title"><div className="mb-5 flex items-center justify-between gap-4"><h2 id="history-title" className="font-serif text-3xl sm:text-4xl">Shift history</h2><button type="button" className="link-button text-sm" onClick={() => void refresh().catch(() => {})}>Refresh</button></div>
        {history.length === 0 ? <div className={`${panel} p-8 text-center text-[#c9bfd0]`}>No completed shifts yet.</div> : <div className="space-y-3">{history.map((item) => <HistoryItem key={item.id} shift={item} nowMs={nowMs} onChanged={() => refreshTipShift(item.id)} />)}</div>}
        {historyError ? <p role="alert" className="mt-4 text-sm text-[#f3b2ca]">{historyError}</p> : null}
        {hasMore ? <button type="button" className={`${secondaryButton} mt-5 w-full`} disabled={historyBusy} onClick={() => void moreHistory()}>{historyBusy ? 'Loading…' : 'Load more shifts'}</button> : null}
      </section>
    </> : null}

    {confirmEnd && active ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090711cc] px-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className={`${panel} w-full max-w-md p-6 sm:p-8`}>
        <h2 id="confirm-title" className="font-serif text-3xl">End this shift?</h2>
        <p className="mt-3 text-[#c9bfd0]">The end time will be saved now. {activeBreak ? `Your active ${activeBreak.is_paid ? 'paid' : 'unpaid'} break will end at the same time.` : 'You can review it in shift history.'}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="button" className={secondaryButton} onClick={() => setConfirmEnd(false)}>Keep shift open</button><button type="button" className={primaryButton} onClick={finishShift}>Confirm end shift</button></div>
      </section>
    </div> : null}
  </div>
}
