import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { beginBreak, endBreak, endShift, loadShift, loadShiftPage, loadShiftSnapshot, startShift } from './api'
import { formatDuration, formatLocalTime, shiftTotals, type ShiftRecord } from './time'
import { loadWageProfiles, type WageProfile } from '../earnings/api'
import { TipsEditor } from '../earnings/TipsEditor'
import { TipTaxWithheldEditor } from '../earnings/TipTaxWithheldEditor'
import { calculateShiftEarnings } from '../earnings/shiftEarnings'
import { centsInput, formatCents, parsePositiveCents } from '../earnings/money'

const ManualShiftEditor = lazy(() => import('./ManualShiftEditor').then((module) => ({ default: module.ManualShiftEditor })))

const panel = 'rounded-[1.75rem] border border-[#9b719a45] bg-[#261b2dbb] shadow-xl shadow-black/10 backdrop-blur-xl'
const primaryButton = 'rounded-2xl bg-[#e9a4bf] px-6 py-3.5 text-base font-semibold text-[#241426] transition hover:bg-[#f2bfd2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'
const secondaryButton = 'rounded-2xl border border-[#b884a382] bg-[#3a2943a8] px-5 py-3.5 text-base font-medium text-[#f4eaf7] transition hover:bg-[#513550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'

function formatCompactDuration(milliseconds: number) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder}m`
  return `${hours}h ${String(remainder).padStart(2, '0')}m`
}

function formatBreakSummary(paidMs: number, unpaidMs: number) {
  const parts = [
    unpaidMs > 0 ? `${formatCompactDuration(unpaidMs)} unpaid` : null,
    paidMs > 0 ? `${formatCompactDuration(paidMs)} paid` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? `Breaks · ${parts.join(' · ')}` : null
}

function BreakDuration({ paidMs, unpaidMs }: { paidMs: number; unpaidMs: number }) {
  return <span>Breaks <strong className="font-medium text-[#f4eaf7]">{formatCompactDuration(paidMs + unpaidMs)}</strong></span>
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatHistoryRange(startedAt: string, endedAt: string | null, startedDate: string, endedDate: string | null) {
  if (!endedAt) return `${formatHistoryTime(startedAt)} – In progress`
  if (endedDate !== null && startedDate !== endedDate) {
    return `${startedDate} · ${formatHistoryTime(startedAt)} – ${endedDate} · ${formatHistoryTime(endedAt)}`
  }
  return `${formatHistoryTime(startedAt)} – ${formatHistoryTime(endedAt)}`
}

function HistoryItem({ shift, nowMs, onChanged, onEdit, highlighted = false }: { shift: ShiftRecord; nowMs: number; onChanged: () => Promise<void>; onEdit: () => void; highlighted?: boolean }) {
  const totals = shiftTotals(shift, nowMs)
  const earnings = calculateShiftEarnings(shift, nowMs)
  const breakSummary = shift.breaks.length > 0 ? formatBreakSummary(totals.paidBreakMs, totals.unpaidBreakMs) : null
  const startedDate = formatHistoryDate(shift.started_at)
  const endedDate = shift.ended_at ? formatHistoryDate(shift.ended_at) : null
  return <article className={`history-card ${panel} rounded-[2rem] p-5 sm:p-7 lg:p-8 ${highlighted ? 'border-[#e9a4bf99]' : ''}`}>
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-serif text-xl leading-tight text-[#f4eaf7] sm:text-2xl lg:text-4xl">{startedDate}</h3>
        <p className="mt-1 break-words text-sm text-[#c9bfd0] sm:text-base lg:text-xl">{formatHistoryRange(shift.started_at, shift.ended_at, startedDate, endedDate)}</p>
      </div>
      {shift.wage_profile_name_snapshot ? <span className="max-w-[45%] shrink-0 rounded-full border border-[#9b719a55] bg-[#3a2943a8] px-3 py-1 text-right text-xs leading-snug text-[#d8c8e2]">{shift.wage_profile_name_snapshot}</span> : null}
    </header>

    <div className="my-4 border-t border-[#9b719a40] sm:my-5 lg:my-6" />

    <dl className="grid grid-cols-2">
      <div className="min-w-0 pr-4">
        <dt className="text-sm text-[#b9a9c4] sm:text-base lg:text-lg">Worked</dt>
        <dd className="mt-1 font-serif text-2xl tabular-nums leading-tight text-[#f4eaf7] sm:text-3xl lg:text-5xl">{formatCompactDuration(totals.workedMs)}</dd>
      </div>
      <div className="min-w-0 border-l border-[#9b719a40] pl-4">
        <dt className="text-sm text-[#b9a9c4] sm:text-base lg:text-lg">Hourly rate</dt>
        <dd className="mt-1 font-serif text-2xl tabular-nums leading-tight text-[#f4eaf7] sm:text-3xl lg:text-5xl" aria-label={shift.hourly_wage_cents_snapshot == null ? 'Hourly rate unavailable' : undefined}>
          {shift.hourly_wage_cents_snapshot == null ? '—' : formatCents(shift.hourly_wage_cents_snapshot)}
        </dd>
      </div>
    </dl>

    {breakSummary ? <p className="mt-3 text-xs text-[#ac9bb7] sm:text-sm">{breakSummary}</p> : null}

    <div className="mt-4 space-y-2 border-t border-[#9b719a30] pt-3 text-sm lg:mt-5 lg:pt-4 lg:text-base">
      {earnings.grossWagesCents !== null ? <div className="flex items-center justify-between gap-4 text-[#c9bfd0]"><span>Wages</span><span className="tabular-nums text-[#f4eaf7]">{formatCents(earnings.grossWagesCents)}</span></div> : null}
      {earnings.totalTipsCents !== null ? <div className="flex items-center justify-between gap-4 text-[#c9bfd0]"><span>Tips</span><span className="tabular-nums text-[#f4eaf7]">{formatCents(earnings.totalTipsCents)}</span></div> : null}
    </div>

    {earnings.grossEarningsCents !== null ? <>
      <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#9b719a30] pt-3">
        <span className="text-sm font-medium text-[#d8c8e2]">Gross earnings</span>
        <span className="text-base font-medium tabular-nums text-[#e8d8ec]">{formatCents(earnings.grossEarningsCents)}</span>
      </div>
      {earnings.tipTaxWithheldCents !== null ? <div className="flex items-center justify-between gap-4 text-sm text-[#c9bfd0]"><span>Tip tax withheld</span><span className="tabular-nums text-[#f4eaf7]">−{formatCents(earnings.tipTaxWithheldCents)}</span></div> : null}
      <div className="mt-2 flex items-center justify-between gap-4 border-t border-[#9b719a30] pt-3">
        <span className="text-sm font-medium text-[#e8d8ec]">After tip withholding</span>
        <span className="font-serif text-2xl tabular-nums text-[#e9a4bf] sm:text-3xl">{earnings.earningsAfterTipWithholdingCents === null ? '—' : formatCents(earnings.earningsAfterTipWithholdingCents)}</span>
      </div>
      <p className="mt-1 text-xs text-[#ac9bb7]">Hourly-wage taxes and other deductions are not included.</p>
    </> : earnings.tipTaxWithheldCents !== null ? <div className="flex items-center justify-between gap-4 text-sm text-[#c9bfd0]"><span>Tip tax withheld</span><span className="tabular-nums text-[#f4eaf7]">−{formatCents(earnings.tipTaxWithheldCents)}</span></div> : null}

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#9b719a30] pt-3">
      {shift.ended_at ? <button type="button" className="link-button text-sm" onClick={onEdit}>Edit shift</button> : null}
      <TipsEditor shift={shift} onChanged={onChanged} showTotal={false} />
    </div>

    <details className="shift-details mt-3 overflow-hidden rounded-2xl border border-[#9b719a50] bg-[#33243d] lg:mt-4">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[#e8d8ec] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#f2bfd2] lg:min-h-14 lg:px-5 lg:text-base">
        <span>Shift details</span>
        <svg className="shift-details-chevron h-4 w-4 shrink-0 text-[#c9a8c5] transition-transform" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div className="space-y-3 border-t border-[#9b719a35] px-4 pb-4 pt-3 text-sm">
        <TipTaxWithheldEditor shift={shift} onChanged={onChanged} />
      </div>
    </details>

    {highlighted ? <p className="mt-3 text-xs text-[#ac9bb7]">Just saved</p> : null}
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
  const [breakPanelOpen, setBreakPanelOpen] = useState(false)
  const [completedId, setCompletedId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<WageProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [manualEditor, setManualEditor] = useState<{ shift: ShiftRecord | null } | null>(null)
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
      setBreakPanelOpen(false)
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

  async function manualShiftSaved() {
    setManualEditor(null)
    try {
      await refresh()
      setNotice('Shift saved.')
    } catch {
      setNotice('Shift saved. Refresh your shifts to load the latest details.')
    }
  }

  async function manualShiftDeleted(shiftId: string) {
    setManualEditor(null)
    setHistory((previous) => previous.filter((item) => item.id !== shiftId))
    setCompletedId((previous) => previous === shiftId ? null : previous)
    setNotice('Shift deleted.')
    try {
      await refresh()
    } catch {
      setNotice('Shift deleted. Refresh your shifts to load the latest history.')
    }
  }

  const activeBreak = active?.breaks.find((item) => !item.ended_at)
  const totals = active ? shiftTotals(active, nowMs) : null
  const activeBreakMs = activeBreak ? Math.max(0, nowMs - Date.parse(activeBreak.started_at)) : 0
  const completed = history.find((item) => item.id === completedId)
  const visibleHistory = completedId ? history.filter((item) => item.id !== completedId) : history
  const controlsDisabled = Boolean(busy || loadError)

  return <div className="relative z-10 w-full py-12 sm:py-16" aria-label="Shift logger">
    {initialLoading ? <p role="status" className="text-[#c9bfd0]">Loading your shifts…</p> : null}
    {loadError ? <div role="alert" className={`${panel} mb-6 p-5 text-[#f5dce8]`}><p>Could not refresh your shifts: {loadError}</p><button type="button" className="link-button mt-3" onClick={() => void refresh().catch(() => {})}>Retry loading</button></div> : null}
    {profileError ? <div role="alert" className="mb-6 rounded-2xl border border-[#e9a4bf55] bg-[#512b43] p-4 text-sm text-[#ffe4ed]">{profileError}<button type="button" className="link-button ml-3" onClick={() => void refresh().catch(() => {})}>Retry</button></div> : null}
    {actionError ? <div role="alert" className="mb-6 rounded-2xl border border-[#e9a4bf55] bg-[#512b43] p-4 text-sm text-[#ffe4ed]"><p>{actionError}</p><button type="button" className="link-button mt-2" onClick={() => void refresh().catch(() => {})}>Refresh state</button></div> : null}
    {notice ? <p role="status" className="mb-6 rounded-2xl bg-[#46314d] p-4 text-sm text-[#f4eaf7]">{notice}</p> : null}

    {!initialLoading && !loadError ? <>
      {active ? <section aria-labelledby="current-shift-title">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 id="current-shift-title" className="font-serif text-4xl tracking-tight text-[#f4eaf7] sm:text-5xl">Current shift</h1>
            {!activeBreak && active.wage_profile_name_snapshot ? <p className="mt-1 break-words text-sm text-[#c9bfd0]">{active.wage_profile_name_snapshot}{active.hourly_wage_cents_snapshot != null ? ` · ${formatCents(active.hourly_wage_cents_snapshot)}/hour${active.hourly_wage_override_cents != null ? ' · override' : ''}` : ''}</p> : null}
            {!activeBreak && !active.wage_profile_name_snapshot && active.hourly_wage_cents_snapshot != null ? <p className="mt-1 text-sm text-[#c9bfd0]">{formatCents(active.hourly_wage_cents_snapshot)}/hour{active.hourly_wage_override_cents != null ? ' · override' : ''}</p> : null}
          </div>
          <span role="status" className={`shrink-0 rounded-full px-3 py-1 text-xs ${activeBreak ? 'bg-[#70465e] text-[#f4dce9]' : 'bg-[#35283d] text-[#c9bfd0]'}`}>{activeBreak ? 'On break' : 'Working'}</span>
        </div>
        <div className={`${panel} relative mt-4 overflow-hidden p-5 sm:p-7 ${activeBreak ? 'border-[#e9a4bf99] bg-[#302033dd]' : ''}`}>
          <p className="relative text-sm font-medium text-[#d8c4df]">{activeBreak ? `${activeBreak.is_paid ? 'Paid' : 'Unpaid'} break` : 'Time worked'}</p>
          <p aria-label={activeBreak ? 'Break elapsed time' : 'Worked time'} className={`relative mt-2 font-serif text-[clamp(3.2rem,13.5vw,6rem)] leading-none tracking-[-0.045em] tabular-nums ${activeBreak ? 'text-[#f4c6d9]' : 'text-[#f4dce9]'}`}>
            {activeBreak ? formatDuration(activeBreakMs) : formatDuration(totals!.workedMs)}
          </p>
          <div className="relative mt-5 flex items-center justify-between gap-3 border-t border-[#9b719a30] pt-3 text-xs text-[#c9bfd0] sm:text-sm">
            <span className="min-w-0 truncate">Started {formatLocalTime(active.started_at)}</span>
            <BreakDuration paidMs={totals!.paidBreakMs} unpaidMs={totals!.unpaidBreakMs} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {activeBreak ? <>
            <button type="button" className={`${secondaryButton} h-14 w-full min-w-0 px-3`} disabled={controlsDisabled} onClick={() => setConfirmEnd(true)}>End shift</button>
            <button type="button" className={`${primaryButton} h-14 w-full min-w-0 px-3`} disabled={controlsDisabled} onClick={finishBreak}>{busy === 'endBreak' ? 'Saving…' : 'End break'}</button>
          </> : <>
            <button type="button" aria-expanded={breakPanelOpen} aria-controls="break-options" className={`${secondaryButton} h-14 w-full min-w-0 px-3`} disabled={controlsDisabled} onClick={() => { setBreakPanelOpen((isOpen) => !isOpen); setPaidBreak(false); setActionError('') }}>Break</button>
            <button type="button" className={`${primaryButton} h-14 w-full min-w-0 px-3`} disabled={controlsDisabled} onClick={() => setConfirmEnd(true)}>End shift</button>
          </>}
        </div>
        {breakPanelOpen && !activeBreak ? <div id="break-options" role="group" aria-label="Break options" className={`${panel} mt-3 flex flex-wrap items-center justify-between gap-4 p-4`}>
          <div><p className="text-sm font-medium">Break options</p><p className="mt-1 text-xs text-[#ac9bb7]">Unpaid by default. Paid breaks count as worked time.</p></div>
          <div className="flex items-center gap-4">
            <label htmlFor="paid-break-toggle" className="text-sm text-[#f4eaf7]">Paid break</label>
            <button id="paid-break-toggle" type="button" role="switch" aria-checked={paidBreak} disabled={controlsDisabled} onClick={() => setPaidBreak((value) => !value)} className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55 ${paidBreak ? 'bg-[#d88eae]' : 'bg-[#58485e]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-[#fff5fa] shadow transition-all ${paidBreak ? 'left-6' : 'left-1'}`} /></button>
          </div>
          <div className="flex w-full justify-end gap-3"><button type="button" className="link-button px-3 py-2 text-sm" disabled={controlsDisabled} onClick={() => { setBreakPanelOpen(false); setPaidBreak(false) }}>Cancel</button><button type="button" className={secondaryButton} disabled={controlsDisabled || (breakRequest.current !== null && breakRequest.current.paid !== paidBreak)} onClick={() => startBreak(paidBreak)}>{busy === 'break' ? 'Saving…' : breakRequest.current ? `Retry ${breakRequest.current.paid ? 'paid' : 'unpaid'} break` : 'Start break'}</button></div>
        </div> : null}
        <TipsEditor shift={active} onChanged={() => refreshTipShift(active.id)} />
        <TipTaxWithheldEditor shift={active} onChanged={() => refreshTipShift(active.id)} />
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

      {completed ? <section className="mt-10" aria-labelledby="completed-title"><h2 id="completed-title" className="mb-4 font-serif text-3xl">Completed shift summary</h2><HistoryItem shift={completed} nowMs={nowMs} onChanged={() => refreshTipShift(completed.id)} onEdit={() => setManualEditor({ shift: completed })} highlighted /></section> : null}
      <section className="mt-12" aria-labelledby="history-title"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="history-title" className="font-serif text-3xl sm:text-4xl">Shift history</h2><div className="flex items-center gap-4"><button type="button" className="link-button text-sm" onClick={() => void refresh().catch(() => {})}>Refresh</button><button type="button" className="rounded-xl bg-[#e9a4bf] px-4 py-2.5 text-sm font-semibold text-[#241426] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55" disabled={Boolean(profileError)} onClick={() => setManualEditor({ shift: null })}>Add shift</button></div></div>
        {visibleHistory.length === 0 ? <div className={`${panel} p-8 text-center text-[#c9bfd0]`}>{completed ? 'No other completed shifts yet.' : 'No completed shifts yet.'}</div> : <div className="space-y-3">{visibleHistory.map((item) => <HistoryItem key={item.id} shift={item} nowMs={nowMs} onChanged={() => refreshTipShift(item.id)} onEdit={() => setManualEditor({ shift: item })} />)}</div>}
        {historyError ? <p role="alert" className="mt-4 text-sm text-[#f3b2ca]">{historyError}</p> : null}
        {hasMore ? <button type="button" className={`${secondaryButton} mt-5 w-full`} disabled={historyBusy} onClick={() => void moreHistory()}>{historyBusy ? 'Loading…' : 'Load more shifts'}</button> : null}
      </section>
    </> : null}

    {manualEditor ? <Suspense fallback={<p role="status" className="fixed inset-x-4 bottom-4 z-50 rounded-xl bg-[#33243d] p-4 text-sm text-[#f4eaf7]">Opening shift editor…</p>}><ManualShiftEditor shift={manualEditor.shift} profiles={profiles} onCancel={() => setManualEditor(null)} onSaved={manualShiftSaved} onDeleted={manualShiftDeleted} /></Suspense> : null}

    {confirmEnd && active ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090711cc] px-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className={`${panel} w-full max-w-md p-6 sm:p-8`}>
        <h2 id="confirm-title" className="font-serif text-3xl">End this shift?</h2>
        <p className="mt-3 text-[#c9bfd0]">The end time will be saved now. {activeBreak ? `Your active ${activeBreak.is_paid ? 'paid' : 'unpaid'} break will end at the same time.` : 'You can review it in shift history.'}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="button" className={secondaryButton} onClick={() => setConfirmEnd(false)}>Keep shift open</button><button type="button" className={primaryButton} onClick={finishShift}>Confirm end shift</button></div>
      </section>
    </div> : null}
  </div>
}
