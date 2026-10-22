import { useRef, useState, type FormEvent } from 'react'
import type { ShiftRecord } from '../shift/time'
import { createTip, deleteTip, updateTip, type Tip } from './api'
import { centsInput, formatCents, parsePositiveCents } from './money'

const field = 'rounded-xl border border-[#9b719a70] bg-[#1d1725] px-3 py-2.5 text-[#f4eaf7] outline-none focus:border-[#e9a4bf]'
const action = 'rounded-xl bg-[#e9a4bf] px-4 py-2.5 text-sm font-semibold text-[#241426] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55'

export function TipsEditor({ shift, onChanged, showTotal = true, showTrigger = true }: { shift: ShiftRecord; onChanged: () => Promise<void>; showTotal?: boolean; showTrigger?: boolean }) {
  const [open, setOpen] = useState(!showTrigger)
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState<Tip['label']>(null)
  const [editing, setEditing] = useState<Tip | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tip | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pendingCreate = useRef<Pick<Tip, 'id' | 'shift_id' | 'amount_cents' | 'label'> | null>(null)
  const total = (shift.tips ?? []).reduce((sum, tip) => sum + tip.amount_cents, 0)

  function edit(tip: Tip) {
    setEditing(tip); setAmount(centsInput(tip.amount_cents)); setLabel(tip.label); setError(''); setOpen(true)
  }

  function resetForm() {
    setEditing(null); setAmount(''); setLabel(null); setOpen(false); pendingCreate.current = null
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = parsePositiveCents(amount)
    if (cents == null) { setError('Enter a tip from $0.01 to $10,000.00.'); return }
    if (pendingCreate.current && (pendingCreate.current.amount_cents !== cents || pendingCreate.current.label !== label)) {
      setError('Retry the pending tip with the same amount and type, or refresh the shift first.'); return
    }
    setBusy(true); setError(''); setNotice('')
    let saved = false
    try {
      if (editing) await updateTip(shift.id, editing.id, cents, label)
      else {
        const request = pendingCreate.current ?? { id: crypto.randomUUID(), shift_id: shift.id, amount_cents: cents, label }
        pendingCreate.current = request
        await createTip(request)
      }
      saved = true
      await onChanged()
      resetForm()
      setNotice(editing ? 'Tip updated.' : 'Tip saved.')
    } catch (cause) {
      setError(saved ? 'Tip saved, but the latest total could not be loaded. Refresh your shifts.' : cause instanceof Error ? cause.message : 'Could not save tip.')
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!deleteTarget) return
    setBusy(true); setError(''); setNotice('')
    let saved = false
    try {
      await deleteTip(shift.id, deleteTarget.id)
      saved = true
      await onChanged()
      setDeleteTarget(null); setNotice('Tip deleted.')
    } catch (cause) {
      setError(saved ? 'Tip deleted, but the latest total could not be loaded. Refresh your shifts.' : cause instanceof Error ? cause.message : 'Could not delete tip.')
    } finally { setBusy(false) }
  }

  return <section className={`${showTotal ? 'mt-4 border-t border-[#9b719a30] pt-4' : 'border-t border-[#9b719a30] pt-3'}`} aria-label="Tips">
    <div className={`flex items-center gap-3 ${showTotal ? 'justify-between' : 'justify-end'}`}>{showTotal ? <div><h4 className="text-sm font-medium text-[#f4eaf7]">Total tips</h4><p className="text-lg tabular-nums text-[#f4dce9]">{formatCents(total)}</p></div> : null}{showTrigger ? <button type="button" className="link-button text-sm" disabled={busy} onClick={() => { setOpen((value) => !value); setError('') }}>{open ? 'Close tips' : 'Manage tips'}</button> : null}</div>
    {notice ? <p role="status" className="mt-2 text-xs text-[#d8c8e2]">{notice}</p> : null}
    {error && !deleteTarget ? <p role="alert" className="mt-2 text-xs text-[#f3b2ca]">{error}</p> : null}
    {open ? <div className="mt-4 space-y-4">
      {shift.tips?.length ? <ul className="space-y-2">{shift.tips.map((tip) => <li key={tip.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#20172880] p-3 text-sm"><span>{tip.label ?? 'Tip'} · {formatCents(tip.amount_cents)}</span><span className="flex gap-3"><button type="button" className="link-button" disabled={busy || pendingCreate.current !== null} onClick={() => edit(tip)}>Edit</button><button type="button" className="link-button" disabled={busy || pendingCreate.current !== null} onClick={() => setDeleteTarget(tip)}>Delete</button></span></li>)}</ul> : <p className="text-xs text-[#ac9bb7]">No tips recorded for this shift.</p>}
      <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2" aria-label={editing ? 'Edit tip' : 'Add tip'}>
        <label className="flex min-w-32 flex-1 flex-col text-xs text-[#c9bfd0]">Amount ($)<input className={field} type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="12.50" required disabled={busy} /></label>
        <label className="flex min-w-28 flex-1 flex-col text-xs text-[#c9bfd0]">Type<select className={field} value={label ?? ''} onChange={(event) => setLabel((event.target.value || null) as Tip['label'])} disabled={busy}><option value="">Unspecified</option><option>Cash</option><option>Card</option><option>Other</option></select></label>
        <button type="submit" className={action} disabled={busy}>{busy ? 'Saving…' : pendingCreate.current ? 'Retry tip' : editing ? 'Save tip' : 'Add tip'}</button>
        {editing ? <button type="button" className="link-button" disabled={busy} onClick={resetForm}>Cancel edit</button> : null}
      </form>
    </div> : null}
    {deleteTarget ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090711cc] px-6"><section role="dialog" aria-modal="true" aria-labelledby={`delete-tip-${deleteTarget.id}`} className="w-full max-w-sm rounded-[1.75rem] border border-[#9b719a70] bg-[#261b2d] p-6"><h2 id={`delete-tip-${deleteTarget.id}`} className="font-serif text-2xl">Delete this tip?</h2><p className="mt-2 text-sm text-[#c9bfd0]">{formatCents(deleteTarget.amount_cents)} will be removed from this shift.</p>{error ? <p role="alert" className="mt-3 text-sm text-[#f3b2ca]">{error}</p> : null}<div className="mt-5 flex gap-3"><button type="button" className={action} disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete tip'}</button><button type="button" className="link-button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button></div></section></div> : null}
  </section>
}
