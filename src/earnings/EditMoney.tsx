import { useState } from 'react'
import type { ShiftRecord } from '../shift/time'
import { TipsEditor } from './TipsEditor'
import { TipTaxWithheldEditor } from './TipTaxWithheldEditor'

const moneyAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#b884a382] bg-[#493653] px-3.5 py-2 text-sm font-medium text-[#f4eaf7] no-underline transition hover:bg-[#5a4168] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]'

export function EditMoney({ shift, onChanged }: { shift: ShiftRecord; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)

  return <div className="min-w-0">
    <button type="button" className={moneyAction} aria-expanded={open} aria-controls={`edit-money-${shift.id}`} onClick={() => setOpen((value) => !value)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6.5h14v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-9Z" /><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5V7" /><path d="M13 11h4m-2 0v.01" /></svg>
      {open ? 'Close Edit Money' : 'Edit Money'}
    </button>
    {open ? <section id={`edit-money-${shift.id}`} aria-label="Edit money" className="mt-3 rounded-2xl border border-[#9b719a35] bg-[#20172880] p-3 sm:p-4">
      <TipsEditor shift={shift} onChanged={onChanged} showTotal={false} showTrigger={false} />
      <TipTaxWithheldEditor shift={shift} onChanged={onChanged} showTrigger={false} />
    </section> : null}
  </div>
}
