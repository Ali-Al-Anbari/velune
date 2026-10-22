import { useState } from 'react'
import type { ShiftRecord } from '../shift/time'
import { TipsEditor } from './TipsEditor'
import { TipTaxWithheldEditor } from './TipTaxWithheldEditor'

export function EditMoney({ shift, onChanged }: { shift: ShiftRecord; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)

  return <div className="min-w-0">
    <button type="button" className="link-button text-sm" aria-expanded={open} aria-controls={`edit-money-${shift.id}`} onClick={() => setOpen((value) => !value)}>
      {open ? 'Close Edit Money' : 'Edit Money'}
    </button>
    {open ? <section id={`edit-money-${shift.id}`} aria-label="Edit money" className="mt-3 rounded-2xl border border-[#9b719a35] bg-[#20172880] p-3 sm:p-4">
      <TipsEditor shift={shift} onChanged={onChanged} showTotal={false} showTrigger={false} />
      <TipTaxWithheldEditor shift={shift} onChanged={onChanged} showTrigger={false} />
    </section> : null}
  </div>
}
