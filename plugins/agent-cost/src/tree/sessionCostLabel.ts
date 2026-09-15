export function sessionCostLabel(amountUsd: number, approximate: boolean): string {
  const prefix = approximate ? '≈' : ''
  if (amountUsd > 0 && amountUsd < 0.0001) return `${prefix}<$0.0001`
  const digits = amountUsd < 1 ? 4 : 2
  return `${prefix}$${amountUsd.toFixed(digits)}`
}
