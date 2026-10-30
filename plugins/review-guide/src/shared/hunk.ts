// Reads one hunk's patch text, an `@@` header and its lines. The Node's note check and the pane's
// hunk links read lines the same way, so both use this one parser.

/** One line of a hunk with its numbers. A deleted row has no new number, an added row no old one. */
type HunkRow = { oldLine: number | null; newLine: number | null; text: string }

const header = (patch: string) => {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(patch)
  return match ? { oldStart: Number(match[1]), newStart: Number(match[2]), newCount: match[3] } : null
}

/** Where a hunk starts: its first new-side line, or its first old-side line when it has no new side,
 *  as in a deleted file. Null for an item with no hunk text. */
export function hunkStart(patch: string): { line: number; side: 'old' | 'new' } | null {
  const start = header(patch)
  if (!start) return null
  return start.newCount === '0' || start.newStart === 0
    ? { line: start.oldStart, side: 'old' }
    : { line: start.newStart, side: 'new' }
}

/** The hunk's lines without their markers. Empty for an item with no hunk text. */
export function hunkRows(patch: string): HunkRow[] {
  const start = header(patch)
  if (!start) return []
  let oldLine = start.oldStart
  let newLine = start.newStart
  const rows: HunkRow[] = []
  for (const line of patch.split('\n').slice(1)) {
    const text = line.slice(1)
    if (line.startsWith('+')) rows.push({ oldLine: null, newLine: newLine++, text })
    else if (line.startsWith('-')) rows.push({ oldLine: oldLine++, newLine: null, text })
    // `\ No newline at end of file` belongs to the row before it and has no number of its own.
    else if (line.startsWith(' ')) rows.push({ oldLine: oldLine++, newLine: newLine++, text })
  }
  return rows
}
