import gitdiffParser from 'gitdiff-parser'
import type { PlainCodeRow, PlainDiffRow } from './model'

/** A GitHub per-file patch is hunks only, and so is what the Changes node sends. gitdiff-parser keys
 *  on a file header, so one is put in front of it. */
export const synth = (path: string, patch: string): string =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`

/**
 * One file's patch as plain rows: gaps, hunk headers, and code lines with their numbers.
 *
 * A patch this parser cannot read is a display problem rather than a missing diff, so it falls back
 * to its raw lines, unnumbered, and the rest of the document is unaffected.
 */
export function parsePatch(path: string, patch: string | null): PlainDiffRow[] {
  if (!patch) return []
  let hunks: ReturnType<typeof gitdiffParser.parse>[number]['hunks']
  try {
    hunks = gitdiffParser.parse(synth(path, patch))[0]?.hunks ?? []
  } catch {
    return rawRows(patch)
  }
  const out: PlainDiffRow[] = []
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]!
    // The gap before this hunk: above the first, or the span since the previous one ended.
    if (i === 0) {
      if (hunk.newStart > 1) out.push({ kind: 'gap', side: 'top', oldStart: 1, newStart: 1, count: hunk.newStart - 1 })
    } else {
      const previous = hunks[i - 1]!
      const oldEnd = previous.oldStart + previous.oldLines - 1
      const newEnd = previous.newStart + previous.newLines - 1
      if (hunk.newStart - newEnd > 1) out.push({ kind: 'gap', side: 'mid', oldStart: oldEnd + 1, newStart: newEnd + 1, count: hunk.newStart - newEnd - 1 })
    }
    out.push({ kind: 'hunk', text: hunk.content || `@@ -${hunk.oldStart} +${hunk.newStart} @@` })
    for (const change of hunk.changes) {
      if (change.type === 'normal') out.push({ kind: 'normal', oldNo: change.oldLineNumber, newNo: change.newLineNumber, raw: change.content })
      else if (change.type === 'insert') out.push({ kind: 'insert', oldNo: null, newNo: change.lineNumber, raw: change.content })
      else out.push({ kind: 'delete', oldNo: change.lineNumber, newNo: null, raw: change.content })
    }
  }
  if (out.length === 0) return rawRows(patch)
  // Lines after the last hunk. Its size needs the file's length (count: null); expanding it reads the
  // new side, and it collapses to nothing if the hunk already reached the end.
  const last = hunks[hunks.length - 1]
  if (last) out.push({ kind: 'gap', side: 'bottom', oldStart: last.oldStart + last.oldLines, newStart: last.newStart + last.newLines, count: null })
  return out
}

function rawRows(patch: string): PlainDiffRow[] {
  return patch.split('\n').map((line): PlainDiffRow => {
    if (line.startsWith('@@')) return { kind: 'hunk', text: line }
    const kind: PlainCodeRow['kind'] = line.startsWith('+') ? 'insert' : line.startsWith('-') ? 'delete' : 'normal'
    const raw = kind !== 'normal' || line.startsWith(' ') ? line.slice(1) : line
    return { kind, oldNo: null, newNo: null, raw }
  })
}
