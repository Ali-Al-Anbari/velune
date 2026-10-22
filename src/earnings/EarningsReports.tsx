import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCents } from './money'
import { calculateEarningsReport } from './reports'
import { loadEarningsReportShifts } from './reportsApi'
import { formatReportPeriod, monthPeriod, moveReportPeriod, periodContainsToday, reportPeriodBounds, weekPeriod, type PeriodMode, type ReportPeriod } from './reportPeriods'
import type { ShiftRecord } from '../shift/time'

const card = 'rounded-[1.5rem] border border-[#9b719a45] bg-[#261b2dbb] p-4 shadow-xl shadow-black/10 backdrop-blur-xl sm:p-5'
const control = 'rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-2.5 text-sm text-[#f4eaf7] outline-none focus:border-[#e9a4bf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]'
const secondaryButton = 'rounded-xl border border-[#b884a382] bg-[#3a2943a8] px-4 py-2.5 text-sm text-[#f4eaf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-45'

function compactDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours}h ${String(remainder).padStart(2, '0')}m` : `${remainder}m`
}

function Metric({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  return <div className="min-w-0">
    <dt className="text-sm text-[#b9a9c4]">{label}</dt>
    <dd className={`${prominent ? 'mt-1 font-serif text-2xl text-[#f4dce9] sm:text-3xl' : 'mt-1 text-xl text-[#f4eaf7]'} break-words tabular-nums`}>{value}</dd>
  </div>
}

function initialPeriod(mode: PeriodMode, now = new Date()): ReportPeriod {
  return mode === 'month' ? monthPeriod(now) : weekPeriod(now)
}

export function EarningsReports({ userId }: { userId: string }) {
  const [mode, setMode] = useState<PeriodMode>('week')
  const [period, setPeriod] = useState<ReportPeriod>(() => initialPeriod('week'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [shifts, setShifts] = useState<ShiftRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [reloadKey, setReloadKey] = useState(0)
  const requestId = useRef(0)
  const periodStartDate = period.startDate
  const periodEndDate = period.endDate
  const report = useMemo(() => calculateEarningsReport(shifts, period, nowMs), [shifts, period, nowMs])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError('')
    loadEarningsReportShifts(userId, { startDate: periodStartDate, endDate: periodEndDate }).then((rows) => {
      if (requestId.current === currentRequest) setShifts(rows)
    }).catch(() => {
      if (requestId.current === currentRequest) setError('Could not load earnings for this period. Check your connection and try again.')
    }).finally(() => {
      if (requestId.current === currentRequest) setLoading(false)
    })
    return () => { requestId.current += 1 }
  }, [userId, periodStartDate, periodEndDate, reloadKey])

  function selectMode(nextMode: PeriodMode) {
    setMode(nextMode)
    if (nextMode === 'custom') {
      setCustomStart(period.startDate)
      setCustomEnd(period.endDate)
    } else {
      const nextPeriod = initialPeriod(nextMode)
      setPeriod(nextPeriod)
      setCustomStart(nextPeriod.startDate)
      setCustomEnd(nextPeriod.endDate)
    }
  }

  function navigatePeriod(direction: -1 | 1) {
    const next = moveReportPeriod(period, mode, direction)
    setPeriod(next)
    if (mode === 'custom') {
      setCustomStart(next.startDate)
      setCustomEnd(next.endDate)
    }
  }

  function applyCustomRange() {
    try {
      const selected = { startDate: customStart, endDate: customEnd }
      reportPeriodBounds(selected)
      setPeriod(selected)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Choose a valid date range.')
    }
  }

  const currentPeriod = periodContainsToday(period)
  const modeName = mode === 'week' ? 'week' : mode === 'month' ? 'month' : 'date range'
  const currentLabel = mode === 'custom' ? 'Selected dates' : `This ${mode}`
  const wagesIncomplete = report.missingWageShiftCount > 0
  const afterWithholding = formatCents(wagesIncomplete
    ? report.knownEarningsAfterTipWithholdingCents
    : report.earningsAfterTipWithholdingCents ?? 0)
  const wagesLabel = wagesIncomplete ? 'Known gross wages' : 'Gross wages'
  const wagesValue = report.grossWagesCents === null && !wagesIncomplete
    ? 'Unavailable'
    : wagesIncomplete && report.knownWageShiftCount === 0
      ? 'Unavailable'
      : formatCents(report.knownGrossWagesCents)

  return <section className="relative z-10 w-full py-8 sm:py-10" aria-labelledby="earnings-title">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 id="earnings-title" className="font-serif text-3xl tracking-tight sm:text-4xl">Earnings reports</h1><p className="mt-1 text-sm text-[#b9a9c4]">Periods follow your device’s local timezone.</p></div>
    </header>

    <div className={`${card} mb-5`}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Report period type">
        {(['week', 'month', 'custom'] as const).map((item) => <button key={item} type="button" aria-pressed={mode === item}
          className={`rounded-full border px-4 py-2 text-sm capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] ${mode === item ? 'border-[#e9a4bf80] bg-[#59384f] text-[#ffe5ef]' : 'border-[#9b719a55] bg-[#211827] text-[#c9bfd0]'}`}
          onClick={() => selectMode(item)}>{item === 'week' ? 'Weekly' : item === 'month' ? 'Monthly' : 'Custom dates'}</button>)}
      </div>

      {mode === 'custom' ? <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-36 flex-1 text-xs text-[#c9bfd0]">Start date<input className={`${control} mt-1.5 w-full`} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
        <label className="min-w-36 flex-1 text-xs text-[#c9bfd0]">End date<input className={`${control} mt-1.5 w-full`} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
        <button type="button" className={secondaryButton} onClick={applyCustomRange}>Apply dates</button>
      </div> : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" className={secondaryButton} aria-label={`Previous ${modeName}`} onClick={() => navigatePeriod(-1)}>← <span className="sr-only">Previous {modeName}</span></button>
        <div className="min-w-0 text-center"><p className="text-xs text-[#ac9bb7]">{currentPeriod ? currentLabel : mode === 'week' ? 'Week' : mode === 'month' ? 'Month' : 'Selected dates'}</p><p className="mt-0.5 text-sm font-medium text-[#f4eaf7] sm:text-base">{formatReportPeriod(period)}</p></div>
        <button type="button" className={secondaryButton} aria-label={`Next ${modeName}`} disabled={currentPeriod} onClick={() => navigatePeriod(1)}>→ <span className="sr-only">Next {modeName}</span></button>
      </div>
    </div>

    {loading ? <div className={`${card} py-12 text-center text-[#c9bfd0]`} role="status">Loading earnings…</div>
      : error ? <div className={`${card} py-10 text-center`} role="alert"><p className="text-sm text-[#ffe4ed]">{error}</p><button type="button" className={`${secondaryButton} mt-4`} onClick={() => setReloadKey((value) => value + 1)}>Try again</button></div>
        : report.shiftCount === 0 ? <div className={`${card} py-12 text-center`}><h2 className="font-serif text-2xl text-[#f4eaf7]">No shifts in this period</h2><p className="mt-2 text-sm text-[#b9a9c4]">Completed and active shifts will appear here when they fall within these dates.</p></div>
          : <>
            <section className="rounded-[1.5rem] border border-[#e9a4bf55] bg-[linear-gradient(135deg,#3c263d,#261b2d_72%)] p-5 shadow-xl shadow-black/10 sm:p-6" aria-labelledby="after-withholding-title">
              <p id="after-withholding-title" className="text-sm font-medium text-[#e8d8ec]">{wagesIncomplete ? 'Known earnings after tip withholding' : 'Earnings after tip withholding'}</p>
              <p className="mt-2 break-words font-serif text-4xl tabular-nums tracking-tight text-[#e9a4bf] sm:text-5xl">{report.earningsAfterTipWithholdingCents == null && !wagesIncomplete ? 'Unavailable' : afterWithholding}</p>
              <p className="mt-2 text-xs leading-relaxed text-[#c9bfd0]">Not final net pay. Hourly-wage taxes and other deductions are not included.</p>
            </section>

            {wagesIncomplete ? <p className="mt-3 rounded-xl border border-[#b89a6c45] bg-[#46382255] px-3 py-2 text-xs leading-relaxed text-[#dac9a5]" role="status">
              Wage information is missing for {report.missingWageShiftCount} {report.missingWageShiftCount === 1 ? 'shift' : 'shifts'}. Amounts shown are known subtotals; the report is incomplete.
            </p> : null}

            <dl className={`${card} mt-3 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-5`}>
              <Metric label="Worked hours" value={compactDuration(report.workedMs)} />
              <Metric label={wagesLabel} value={wagesValue} />
              <Metric label="Total tips" value={formatCents(report.totalTipsCents)} />
              <Metric label="Gross earnings" value={report.grossEarningsCents == null ? 'Incomplete' : formatCents(report.grossEarningsCents)} />
              <Metric label="Recorded tip withholding" value={report.tipTaxWithheldCents == null ? 'Not entered' : formatCents(report.tipTaxWithheldCents)} />
            </dl>

            <section className={`${card} mt-4`} aria-labelledby="profile-breakdown-title">
              <header className="mb-4 flex items-center justify-between gap-4"><h2 id="profile-breakdown-title" className="font-serif text-2xl">Wage profile breakdown</h2><span className="text-xs text-[#ac9bb7]">{report.shiftCount} {report.shiftCount === 1 ? 'shift' : 'shifts'}</span></header>
              {report.wageProfiles.length === 0 ? <p className="text-sm text-[#b9a9c4]">No worked hours in this period.</p> : <ul className="divide-y divide-[#9b719a30]">
                {report.wageProfiles.map((item) => <li key={item.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-[#f4eaf7]">{item.name}</p><p className="mt-0.5 text-xs text-[#ac9bb7]">{compactDuration(item.workedMs)}</p></div>
                  <div className="text-right"><p className="text-sm tabular-nums text-[#d8c8e2]">{item.knownWageShiftCount === 0 && item.missingWageShiftCount > 0 ? 'Unavailable' : `${formatCents(item.knownWagesCents)}${item.missingWageShiftCount > 0 ? ' known' : ''}`}</p>
                    {item.missingWageShiftCount > 0 ? <p className="mt-0.5 text-[11px] text-[#c5ad8a]">{item.missingWageShiftCount} missing wage {item.missingWageShiftCount === 1 ? 'snapshot' : 'snapshots'}</p> : null}</div>
                </li>)}
              </ul>}
            </section>
          </>}
  </section>
}
