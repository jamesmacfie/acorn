import type { Guide, GuideNote } from '../shared/guide'
import { hunkRows } from '../shared/hunk'

// A diff covered in notes is a diff nobody reads. The title cap also fits a diff mark's text.
const NOTES_PER_HUNK = 3
const NOTES_PER_GUIDE = 40
const TITLE_CHARS = 120
const BODY_CHARS = 600

/**
 * Hold each note of a covered guide to the line it quotes, because harnesses misnumber lines and a note
 * on the wrong line is worse than none. The quoted text is the anchor and the number is a hint: a note
 * whose number misses moves to the one row on its side that has its text, and otherwise it's dropped.
 * So is a note on a hunk outside its step, or past the caps, in reading order. Every drop adds to
 * `misplacedNotes`.
 */
export function checkNotes(guide: Guide): Guide {
  let dropped = 0
  let kept = 0
  const steps = guide.steps.map((step) => {
    const perHunk = new Map<string, number>()
    const notes = step.notes.flatMap((note) => {
      const item = step.items.find((candidate) => candidate.id === note.hunk)
      const line = item ? placedLine(note, item.patch) : null
      const onHunk = perHunk.get(note.hunk) ?? 0
      if (line === null || onHunk >= NOTES_PER_HUNK || kept >= NOTES_PER_GUIDE) {
        dropped++
        return []
      }
      perHunk.set(note.hunk, onHunk + 1)
      kept++
      return [{ ...note, line, title: clip(note.title, TITLE_CHARS), body: clip(note.body, BODY_CHARS) }]
    })
    return { ...step, notes }
  })
  return { ...guide, steps, misplacedNotes: guide.misplacedNotes + dropped }
}

/** The line on the note's side whose text it quotes: its own number when that matches, else the only
 *  row that does. Null when no row or more than one does. */
function placedLine(note: GuideNote, patch: string): number | null {
  const quoted = note.text.trimEnd()
  const lines = hunkRows(patch).flatMap((row) => {
    // The old side is the deleted rows. An unchanged row is on the new side.
    const line = note.side === 'new' ? row.newLine : row.newLine === null ? row.oldLine : null
    return line !== null && row.text.trimEnd() === quoted ? [line] : []
  })
  if (lines.includes(note.line)) return note.line
  return lines.length === 1 ? lines[0]! : null
}

/** `text` cut at the last word that fits in `max` characters, or at `max` when one word is longer. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1).replace(/\s+\S*$/, '')
  return cut && cut.length <= max ? cut : text.slice(0, max)
}
