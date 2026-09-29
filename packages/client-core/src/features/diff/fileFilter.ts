import { fuzzyHits } from '../../kit/lib/controls/fuzzy'

/** Which characters of `path` the file filter marks, or `null` when the file is filtered out.
 *
 *  A query that appears whole in the path is marked where it appears last, so `cell` marks the file
 *  name rather than a directory above it. Only a query that does not appear whole falls back to the
 *  fuzzy subsequence, whose leftmost hits would otherwise scatter across the directories. */
export function fileFilterMarks(query: string, path: string): number[] | null {
  const q = query.trim()
  if (!q) return []
  const at = path.toLowerCase().lastIndexOf(q.toLowerCase())
  if (at >= 0) return Array.from(q, (_, i) => at + i)
  return fuzzyHits(q, path)
}
