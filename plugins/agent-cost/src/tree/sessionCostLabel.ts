export function sessionCostLabel(amountUsd: number, approximate: boolean): string {
  const prefix = approximate ? '≈' : ''
  if (amountUsd > 0 && amountUsd < 0.01) return `${prefix}<$0.01`
  return `${prefix}$${amountUsd.toFixed(2)}`
}
