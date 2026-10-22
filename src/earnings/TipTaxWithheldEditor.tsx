import { useEffect, useId, useState, type FormEvent } from 'react'
import type { ShiftRecord } from '../shift/time'
import { setShiftTipTaxWithheld } from './api'
import { centsInput, formatCents, parseNonnegativeCents } from './money'

const field = 'mt-1.5 w-full rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-2.5 text-[#f4eaf7] outline-none focus:border-[#e9a4bf]'
const button = 'rounded-xl bg-[#e9a4bf] px-4 py-2.5 text-sm font-semibold text-[#241426] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55'

export function TipTaxWithheldEditor({ shift, onChanged, showTrigger = true }: { shift: ShiftRecord; onChanged: () => Promise<void>; showTrigger?: boolean }) {
  const helpId = useId()
  const [amount, setAmount] = useState(() => centsInput(shift.tip_tax_withheld_cents ?? null))
  const [editing, setEditing] = useState(!showTrigger)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => setAmount(centsInput(shift.tip_tax_withheld_cents ?? null)), [shift.id, shift.tip_tax_withheld_cents])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = parseNonnegativeCents(amount)
    if (Number.isNaN(cents)) {
      setError('Enter an amount from $0.00 to $10,000.00, using up to two decimals.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    let saved = false
    try {
      await setShiftTipTaxWithheld(shift.id, cents)
      saved = true
      setAmount(centsInput(cents))
      await onChanged()
      setNotice('Tip tax withholding saved.')
      setEditing(false)
    } catch (cause) {
      setError(saved
        ? 'Withholding was saved, but the latest shift could not be loaded. Refresh your shifts.'
        : cause instanceof Error ? cause.message : 'Could not save tip tax withholding.')
    } finally {
      setBusy(false)
    }
  }

  const savedAmount = centsInput(shift.tip_tax_withheld_cents ?? null)
  const unchanged = amount.trim() === savedAmount

  return <section className="border-t border-[#9b719a30] pt-3" aria-label="Tip tax withholding">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-[#c9bfd0]">Tip tax withheld</p>
        <p className="mt-0.5 text-sm tabular-nums text-[#f4eaf7]">{shift.tip_tax_withheld_cents == null ? 'Not entered' : formatCents(shift.tip_tax_withheld_cents)}</p>
      </div>
      {showTrigger ? <button type="button" className="rounded-lg px-3 py-2 text-sm text-[#e9a4bf] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55" aria-label={editing ? 'Cancel tip tax withholding edit' : 'Edit tip tax withholding'} aria-expanded={editing} aria-controls={editing ? helpId : undefined} disabled={busy} onClick={() => { setEditing((open) => !open); setAmount(centsInput(shift.tip_tax_withheld_cents ?? null)); setError(''); setNotice('') }}>{editing ? 'Cancel' : 'Edit'}</button> : null}
    </div>
    {editing ? <div id={helpId}>
      <form onSubmit={(event) => void save(event)} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 text-xs text-[#c9bfd0]">Tip tax withheld ($)
          <input className={field} type="text" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(''); setNotice('') }} placeholder="Not entered" aria-describedby={`${helpId}-hint`} disabled={busy} />
        </label>
        <button type="submit" className={button} disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save withholding'}</button>
      </form>
      <p id={`${helpId}-hint`} className="mt-2 text-xs text-[#ac9bb7]">Optional manual amount. Leave blank for none; enter 0 to record an explicit $0.00.</p>
    </div> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-[#d8c8e2]">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-[#f3b2ca]">{error}</p> : null}
  </section>
}
