export const MAX_CENTS = 1_000_000

export function parsePositiveCents(value: string): number | null {
  const input = value.trim()
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(input)) return null
  const [whole, fraction = ''] = input.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= MAX_CENTS ? cents : null
}

export function parseWithholdingBps(value: string): number | null {
  const input = value.trim()
  if (input === '') return null
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(input)) return NaN
  const [whole, fraction = ''] = input.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000 ? bps : NaN
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function centsInput(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2)
}
