import { structuredPatch, type StructuredPatchHunk } from 'diff'

// The hunks of a file change, written the way the rest of acorn stores a single file's patch: from
// the first `@@` on, with no `---`/`+++` header. That is what GitHub hands back and what Codex sends
// for an edit, and it is what the client's diff parser expects, because it adds a header of its own
// before parsing (@acorn/diff-document § synth).

/** The hunks that turn `before` into `after`. `shift` moves them to where the text sits in the file,
 *  for when `before` and `after` are an excerpt whose place is known. */
export const diffHunks = (
  before: string,
  after: string,
  shift: { old: number; new: number } = { old: 0, new: 0 },
): StructuredPatchHunk[] =>
  structuredPatch('', '', withEol(before), withEol(after), '', '', { context: 3 }).hunks.map((hunk) => ({
    ...hunk,
    oldStart: hunk.oldStart + shift.old,
    newStart: hunk.newStart + shift.new,
  }))

// An empty side is written as starting one line earlier, the line it follows, which is how a new
// file comes out as `-0,0`. jsdiff's own formatPatch makes the same adjustment.
export const hunksText = (hunks: readonly StructuredPatchHunk[]): string =>
  hunks.map((hunk) => [
    `@@ -${hunk.oldLines ? hunk.oldStart : hunk.oldStart - 1},${hunk.oldLines} +${hunk.newLines ? hunk.newStart : hunk.newStart - 1},${hunk.newLines} @@`,
    ...hunk.lines,
  ].join('\n')).join('\n')

// An excerpt usually stops mid-file with no newline at the end. Without one on both sides, every
// diff ends in a pair of "\ No newline at end of file" markers that say nothing about the file.
const withEol = (text: string): string => (text && !text.endsWith('\n') ? `${text}\n` : text)
