const D1_MAX_BOUND_PARAMS = 100

export function chunkRowsByColumnBudget<T extends object>(rows: T[], maxParams = D1_MAX_BOUND_PARAMS): T[][] {
  if (rows.length === 0) return []
  const columns = Object.keys(rows[0]!).length
  const size = Math.max(1, Math.floor(maxParams / columns))
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size))
}
