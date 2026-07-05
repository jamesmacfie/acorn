// Conservative per-statement bound-parameter budget for multi-row inserts. better-sqlite3 allows
// far more (SQLITE_MAX_VARIABLE_NUMBER defaults to 32766), but 100 keeps statements small and
// predictable; raise it only if chunking ever shows up as a real cost.
const MAX_BOUND_PARAMS = 100

export function chunkRowsByColumnBudget<T extends object>(rows: T[], maxParams = MAX_BOUND_PARAMS): T[][] {
  if (rows.length === 0) return []
  const columns = Object.keys(rows[0]!).length
  const size = Math.max(1, Math.floor(maxParams / columns))
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size))
}
