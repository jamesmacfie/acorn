/** Which characters of `path` the file filter marks, or `null` when the file is filtered out.
 *
 *  The query matches as a whole, ignoring case, where it appears last in the path, so `cell` marks
 *  the file name rather than a directory above it. */
export function fileFilterMarks(query: string, path: string): number[] | null {
  const q = query.trim()
  if (!q) return []
  const at = path.toLowerCase().lastIndexOf(q.toLowerCase())
  return at < 0 ? null : Array.from(q, (_, i) => at + i)
}
