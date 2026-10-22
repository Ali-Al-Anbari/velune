import type { ShiftRecord } from './time'
import { shiftTotals } from './time'
import { calculateShiftEarnings } from '../earnings/shiftEarnings'
import { formatCents } from '../earnings/money'
import { EditMoney } from '../earnings/EditMoney'

const panel = 'rounded-[1.75rem] border border-[#9b719a45] bg-[#261b2dbb] shadow-xl shadow-black/10 backdrop-blur-xl'

function compactDuration(milliseconds: number) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours === 0 ? `${remainder}m` : `${hours}h ${String(remainder).padStart(2, '0')}m`
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatHistoryRange(startedAt: string, endedAt: string | null, startedDate: string, endedDate: string | null) {
  if (!endedAt) return `${formatHistoryTime(startedAt)} – In progress`
  if (endedDate !== null && startedDate !== endedDate) return `${startedDate} · ${formatHistoryTime(startedAt)} – ${endedDate} · ${formatHistoryTime(endedAt)}`
  return `${formatHistoryTime(startedAt)} – ${formatHistoryTime(endedAt)}`
}

export function ShiftHistoryItem({ shift, nowMs, onChanged, onEdit, highlighted = false }: {
  shift: ShiftRecord
  nowMs: number
  onChanged: () => Promise<void>
  onEdit: () => void
  highlighted?: boolean
}) {
  const totals = shiftTotals(shift, nowMs)
  const earnings = calculateShiftEarnings(shift, nowMs)
  const startedDate = formatHistoryDate(shift.started_at)
  const endedDate = shift.ended_at ? formatHistoryDate(shift.ended_at) : null

  return <article className={`history-card ${panel} rounded-[2rem] p-5 sm:p-7 lg:p-8 ${highlighted ? 'border-[#e9a4bf99]' : ''}`}>
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-serif text-xl leading-tight text-[#f4eaf7] sm:text-2xl lg:text-4xl">{startedDate}</h3>
        <p className="mt-1 break-words text-sm text-[#c9bfd0] sm:text-base lg:text-xl">{formatHistoryRange(shift.started_at, shift.ended_at, startedDate, endedDate)}</p>
      </div>
      {shift.wage_profile_name_snapshot ? <span className="max-w-[45%] shrink-0 rounded-full border border-[#9b719a55] bg-[#3a2943a8] px-3 py-1 text-right text-xs leading-snug text-[#d8c8e2]">{shift.wage_profile_name_snapshot}</span> : null}
    </header>
    <div className="my-4 border-t border-[#9b719a40] sm:my-5" />
    <dl className="grid grid-cols-2">
      <div className="min-w-0 pr-4"><dt className="text-sm text-[#b9a9c4]">Worked</dt><dd className="mt-1 font-serif text-2xl tabular-nums leading-tight text-[#f4eaf7] sm:text-3xl">{compactDuration(totals.workedMs)}</dd></div>
      <div className="min-w-0 border-l border-[#9b719a40] pl-4"><dt className="text-sm text-[#b9a9c4]">Hourly rate</dt><dd className="mt-1 font-serif text-2xl tabular-nums leading-tight text-[#f4eaf7] sm:text-3xl" aria-label={shift.hourly_wage_cents_snapshot == null ? 'Hourly rate unavailable' : undefined}>{shift.hourly_wage_cents_snapshot == null ? '—' : formatCents(shift.hourly_wage_cents_snapshot)}</dd></div>
    </dl>
    {shift.breaks.length > 0 ? <p className="mt-3 text-xs text-[#ac9bb7] sm:text-sm">Breaks · {compactDuration(totals.paidBreakMs + totals.unpaidBreakMs)}</p> : null}
    <div className="mt-4 space-y-2 border-t border-[#9b719a30] pt-3 text-sm">
      {earnings.grossWagesCents !== null ? <div className="flex items-center justify-between gap-4 text-[#c9bfd0]"><span>Wages</span><span className="tabular-nums text-[#f4eaf7]">{formatCents(earnings.grossWagesCents)}</span></div> : null}
      {earnings.totalTipsCents !== null ? <div className="flex items-center justify-between gap-4 text-[#c9bfd0]"><span>Tips</span><span className="tabular-nums text-[#f4eaf7]">{formatCents(earnings.totalTipsCents)}</span></div> : null}
    </div>
    {earnings.grossEarningsCents !== null ? <>
      <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#9b719a30] pt-3"><span className="text-sm font-medium text-[#d8c8e2]">Gross earnings</span><span className="text-base font-medium tabular-nums text-[#e8d8ec]">{formatCents(earnings.grossEarningsCents)}</span></div>
      {earnings.tipTaxWithheldCents !== null ? <div className="flex items-center justify-between gap-4 text-sm text-[#c9bfd0]"><span>Tip tax withheld</span><span className="tabular-nums text-[#f4eaf7]">−{formatCents(earnings.tipTaxWithheldCents)}</span></div> : null}
      <div className="mt-2 flex items-center justify-between gap-4 border-t border-[#9b719a30] pt-3"><span className="text-sm font-medium text-[#e8d8ec]">After tip withholding</span><span className="font-serif text-2xl tabular-nums text-[#e9a4bf] sm:text-3xl">{earnings.earningsAfterTipWithholdingCents === null ? '—' : formatCents(earnings.earningsAfterTipWithholdingCents)}</span></div>
      <p className="mt-1 text-xs text-[#ac9bb7]">Hourly-wage taxes and other deductions are not included.</p>
    </> : earnings.tipTaxWithheldCents !== null ? <div className="flex items-center justify-between gap-4 text-sm text-[#c9bfd0]"><span>Tip tax withheld</span><span className="tabular-nums text-[#f4eaf7]">−{formatCents(earnings.tipTaxWithheldCents)}</span></div> : null}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#9b719a30] pt-3">
      {shift.ended_at ? <button type="button" className="link-button text-sm" onClick={onEdit}>Edit shift</button> : null}
      <EditMoney shift={shift} onChanged={onChanged} />
    </div>
    {highlighted ? <p className="mt-3 text-xs text-[#ac9bb7]">Just saved</p> : null}
  </article>
}
