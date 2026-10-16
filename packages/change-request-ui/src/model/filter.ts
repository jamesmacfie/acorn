import type { ChangeRequestSummary } from './types'

// The text filter over a list's loaded rows: number, title, author, and source branch, without case.
// Rows past the loaded pages come from the host's own search, not from here.
export const filterChangeRequests = <T extends Pick<ChangeRequestSummary, 'number' | 'title' | 'author' | 'headRef'>>(
  rows: T[],
  query: string,
  prefix: string,
): T[] => {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) =>
    `${prefix}${row.number} ${row.title} ${row.author ?? ''} ${row.headRef ?? ''}`.toLowerCase().includes(q),
  )
}
