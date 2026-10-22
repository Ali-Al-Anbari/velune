import { useId, useState, type FormEvent } from 'react'
import { centsInput, parsePositiveCents } from '../earnings/money'
import type { WageProfile } from '../earnings/api'
import { createManualShift, manualShiftErrorMessage, updateCompletedShift, type ManualBreakInput } from './api'
import { localDateTimeInput, parseLocalDateTimeInput, type BreakRecord, type ShiftRecord, validateManualShiftRange } from './time'

type BreakDraft = { id: string; startedAt: string; endedAt: string; isPaid: boolean; originalStartedAt?: string; originalEndedAt?: string }
type Props = { shift: ShiftRecord | null; profiles: WageProfile[]; onCancel: () => void; onSaved: () => Promise<void> }

const field = 'scheme-dark mt-1 w-full min-w-0 rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-3 text-[#f4eaf7] outline-none focus:border-[#e9a4bf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]'
const primary = 'rounded-xl bg-[#e9a4bf] px-5 py-3 text-sm font-semibold text-[#241426] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55'
const secondary = 'rounded-xl border border-[#b884a382] bg-[#3a2943a8] px-4 py-3 text-sm text-[#f4eaf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55'

function defaultRange() {
  const end = new Date(Date.now())
  end.setSeconds(0, 0)
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000)
  return { startedAt: localDateTimeInput(start.toISOString()), endedAt: localDateTimeInput(end.toISOString()), startedIso: start.toISOString(), endedIso: end.toISOString() }
}

function fromBreak(item: BreakRecord): BreakDraft {
  return { id: item.id, startedAt: localDateTimeInput(item.started_at), endedAt: item.ended_at ? localDateTimeInput(item.ended_at) : '', isPaid: item.is_paid, originalStartedAt: item.started_at, originalEndedAt: item.ended_at ?? undefined }
}

function makeBreaks(drafts: BreakDraft[], start: string, end: string): ManualBreakInput[] {
  const breaks = drafts.map((item) => ({
    id: item.id,
    started_at: item.originalStartedAt && item.startedAt === localDateTimeInput(item.originalStartedAt) ? item.originalStartedAt : parseLocalDateTimeInput(item.startedAt),
    ended_at: item.originalEndedAt && item.endedAt === localDateTimeInput(item.originalEndedAt) ? item.originalEndedAt : parseLocalDateTimeInput(item.endedAt),
    is_paid: item.isPaid,
  }))
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  const ordered = [...breaks].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  let previousEnd = startMs
  for (const item of ordered) {
    const breakStart = Date.parse(item.started_at)
    const breakEnd = Date.parse(item.ended_at)
    if (breakStart >= breakEnd) throw new Error('Break start must be earlier than break end.')
    if (breakStart < startMs || breakEnd > endMs) throw new Error('Each break must fall within the shift times.')
    if (breakStart < previousEnd) throw new Error('Breaks cannot overlap.')
    previousEnd = breakEnd
  }
  return breaks
}

export function ManualShiftEditor({ shift, profiles, onCancel, onSaved }: Props) {
  const dialogId = useId()
  const [range] = useState(defaultRange)
  const initialStartedAt = shift ? localDateTimeInput(shift.started_at) : range.startedAt
  const initialEndedAt = shift?.ended_at ? localDateTimeInput(shift.ended_at) : range.endedAt
  const initialStartedIso = shift?.started_at ?? range.startedIso
  const initialEndedIso = shift?.ended_at ?? range.endedIso
  const [startedAt, setStartedAt] = useState(initialStartedAt)
  const [endedAt, setEndedAt] = useState(initialEndedAt)
  const [profileId, setProfileId] = useState(() => shift?.wage_profile_id ?? profiles.find((item) => item.is_default && !item.is_archived)?.id ?? '')
  const [override, setOverride] = useState(() => centsInput(shift?.hourly_wage_override_cents ?? null))
  const [breaks, setBreaks] = useState<BreakDraft[]>(() => (shift?.breaks ?? []).map(fromBreak))
  const [dirty, setDirty] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createIds] = useState(() => ({ shiftId: crypto.randomUUID(), requestId: crypto.randomUUID() }))
  const activeProfiles = profiles.filter((item) => !item.is_archived)
  const archivedSelection = profiles.find((item) => item.id === profileId && item.is_archived)
  const selectedProfile = profiles.find((item) => item.id === profileId)

  function change<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setDirty(true)
    setError('')
  }

  function addBreak() {
    setBreaks((items) => [...items, { id: crypto.randomUUID(), startedAt: '', endedAt: '', isPaid: false }])
    setDirty(true)
    setError('')
  }

  function updateBreak(id: string, update: Partial<BreakDraft>) {
    setBreaks((items) => items.map((item) => item.id === id ? { ...item, ...update } : item))
    setDirty(true)
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    let started: string
    let ended: string
    let wageOverride: number | null
    let breakInputs: ManualBreakInput[]
    try {
      started = startedAt === initialStartedAt ? initialStartedIso : parseLocalDateTimeInput(startedAt)
      ended = endedAt === initialEndedAt ? initialEndedIso : parseLocalDateTimeInput(endedAt)
      validateManualShiftRange(started, ended)
      wageOverride = override.trim() === '' ? null : parsePositiveCents(override)
      if (override.trim() !== '' && wageOverride === null) throw new Error('Enter an hourly wage override from $0.01 to $10,000.00.')
      breakInputs = makeBreaks(breaks, started, ended)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the shift and break times.')
      return
    }

    setSaving(true)
    try {
      if (shift) {
        await updateCompletedShift(shift.id, shift.manual_edit_version ?? 0, {
          started_at: started, ended_at: ended, wage_profile_id: profileId || null,
          hourly_wage_override_cents: wageOverride, breaks: breakInputs,
        })
      } else {
        await createManualShift(createIds.shiftId, createIds.requestId, {
          started_at: started, ended_at: ended, wage_profile_id: profileId || null,
          hourly_wage_override_cents: wageOverride, breaks: breakInputs,
        })
      }
      await onSaved()
    } catch (cause) {
      setError(manualShiftErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#090711cc] p-2 sm:items-center sm:p-6">
    <section role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-[1.75rem] border border-[#9b719a70] bg-[#261b2d] p-5 shadow-2xl shadow-black/40 sm:p-7">
      <header className="flex items-start justify-between gap-4">
        <div><h2 id={`${dialogId}-title`} className="font-serif text-3xl text-[#f4eaf7]">{shift ? 'Edit shift' : 'Add shift'}</h2><p className="mt-1 text-sm text-[#ac9bb7]">Times use your device’s local timezone. Repeated fall-back times use the earlier occurrence; nonexistent clock-change times are rejected. Shifts are limited to 24 hours.</p></div>
        <button type="button" className="link-button shrink-0 px-2 py-1" aria-label="Close shift editor" disabled={saving} onClick={() => dirty ? setDiscarding(true) : onCancel()}>Cancel</button>
      </header>

      <form className="mt-5 space-y-5" onSubmit={(event) => void save(event)}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-[#c9bfd0]">Start date and time<input className={field} type="datetime-local" step="60" required value={startedAt} disabled={saving} onChange={(event) => change(setStartedAt, event.target.value)} /></label>
          <label className="text-sm text-[#c9bfd0]">End date and time<input className={field} type="datetime-local" step="60" required value={endedAt} disabled={saving} onChange={(event) => change(setEndedAt, event.target.value)} /></label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-[#c9bfd0]">Wage profile<select className={field} value={profileId} disabled={saving} onChange={(event) => change(setProfileId, event.target.value)}><option value="">No profile</option>{archivedSelection ? <option value={archivedSelection.id}>{archivedSelection.name} · archived</option> : null}{activeProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_default ? ' · default' : ''}</option>)}</select></label>
          <label className="text-sm text-[#c9bfd0]">Hourly wage override ($) · optional<input className={field} type="text" inputMode="decimal" value={override} placeholder={selectedProfile ? centsInput(selectedProfile.hourly_wage_cents) : '18.50'} disabled={saving} onChange={(event) => change(setOverride, event.target.value)} /></label>
        </div>

        <section aria-labelledby={`${dialogId}-breaks`}>
          <div className="flex items-center justify-between gap-3"><div><h3 id={`${dialogId}-breaks`} className="text-sm font-medium text-[#e8d8ec]">Breaks</h3><p className="mt-1 text-xs text-[#ac9bb7]">Paid breaks count as worked time; unpaid breaks are excluded.</p></div><button type="button" className={secondary} disabled={saving} onClick={addBreak}>Add break</button></div>
          {breaks.length > 0 ? <div className="mt-3 space-y-3">{breaks.map((item, index) => <fieldset key={item.id} className="rounded-xl border border-[#9b719a45] bg-[#20172880] p-3">
            <legend className="px-1 text-xs text-[#ac9bb7]">Break {index + 1}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-[#c9bfd0]">Start<input className={field} type="datetime-local" step="60" required value={item.startedAt} disabled={saving} onChange={(event) => updateBreak(item.id, { startedAt: event.target.value })} /></label>
              <label className="text-xs text-[#c9bfd0]">End<input className={field} type="datetime-local" step="60" required value={item.endedAt} disabled={saving} onChange={(event) => updateBreak(item.id, { endedAt: event.target.value })} /></label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-[#d8c8e2]"><input type="checkbox" checked={item.isPaid} disabled={saving} onChange={(event) => updateBreak(item.id, { isPaid: event.target.checked })} />Paid break</label><button type="button" className="link-button text-sm" disabled={saving} onClick={() => { setBreaks((items) => items.filter((candidate) => candidate.id !== item.id)); setDirty(true) }}>Remove</button></div>
          </fieldset>)}</div> : <p className="mt-3 text-xs text-[#ac9bb7]">No breaks recorded.</p>}
        </section>

        {error ? <p role="alert" className="rounded-xl border border-[#e9a4bf55] bg-[#512b43] p-3 text-sm text-[#ffe4ed]">{error}</p> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" className={secondary} disabled={saving} onClick={() => dirty ? setDiscarding(true) : onCancel()}>Cancel</button><button type="submit" className={primary} disabled={saving || Boolean(shift && !dirty)}>{saving ? 'Saving…' : shift ? 'Save changes' : 'Add completed shift'}</button></div>
      </form>
    </section>
    {discarding ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#090711cc] px-5"><section role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-discard-title`} className="w-full max-w-sm rounded-2xl border border-[#9b719a70] bg-[#261b2d] p-5"><h3 id={`${dialogId}-discard-title`} className="font-serif text-2xl">Discard changes?</h3><p className="mt-2 text-sm text-[#c9bfd0]">Your unsaved shift changes will be lost.</p><div className="mt-5 flex justify-end gap-3"><button type="button" className={secondary} onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className={primary} onClick={onCancel}>Discard</button></div></section></div> : null}
  </div>
}
