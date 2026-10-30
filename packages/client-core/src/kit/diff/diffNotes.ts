// Notes a tree pins under the rows of a `StackedDiff`, shared by both hosts' `StackedDiff`.
//
// A tree's props are data, so a note can't be a prop of the diff. It is a child node, `DiffNote`,
// that draws nothing where it stands: it hands its props to the `StackedDiff` above it, which draws
// it under the row it names. Outside a `StackedDiff` there is nobody to hand them to, so the note is
// omitted, as a node the host doesn't know is.
import { createContext, createSignal, onCleanup, useContext, type Accessor, type Setter } from 'solid-js'
import type { CodeRow, HunkRow } from './diffModel'

/** One line of a diff, named the way a review names it: deleted rows on the old side, everything
 *  else on the new. What a line's ✦ sends, and where a note goes. */
export type DiffLinePlace = { side: 'old' | 'new'; line: number }

export type DiffNoteProps<Children = unknown> = DiffLinePlace & {
  tone?: 'neutral' | 'warn' | 'danger'
  /** The tone's word in the header, such as "Risk". */
  label?: string
  /** Who wrote the note, such as "Claude Code". */
  author?: string
  /** One line, and all a folded note shows. */
  title?: string
  /** The body and the plugin's own buttons. */
  children?: Children
}

/** A note as its `StackedDiff` holds it. The fold lives with the note's node, so it survives the
 *  note moving to another row. */
export type PinnedNote<Children = unknown> = {
  props: DiffNoteProps<Children>
  folded: Accessor<boolean>
  setFolded: Setter<boolean>
}

const DiffNotesContext = createContext<(note: PinnedNote) => () => void>()

/** A `StackedDiff`'s notes, in the order they arrived. Hand `pin` to `DiffNotesProvider`. */
export function createPinnedNotes<Children>() {
  const [notes, setNotes] = createSignal<PinnedNote<Children>[]>([])
  const pin = (note: PinnedNote): (() => void) => {
    setNotes((list) => [...list, note as PinnedNote<Children>])
    return () => setNotes((list) => list.filter((entry) => entry !== note))
  }
  return { notes, pin }
}

export const DiffNotesProvider = DiffNotesContext.Provider

/** The kit node. It draws nothing itself; see the top of this file. */
export function DiffNote(props: DiffNoteProps) {
  const pin = useContext(DiffNotesContext)
  const [folded, setFolded] = createSignal(false)
  if (pin) onCleanup(pin({ props, folded, setFolded }))
  return null
}

export const linePlace = (row: CodeRow): DiffLinePlace | null => {
  const line = row.kind === 'delete' ? row.oldNo : row.newNo
  return line == null ? null : { side: row.kind === 'delete' ? 'old' : 'new', line }
}

/** Which row each note sits under, by index into `rows`: the first code row at its side and line.
 *  A note naming a line the patch doesn't have goes in `unplaced`, which a host draws after the last
 *  row so a bad anchor is seen rather than lost. */
export function placeNotes<Note extends PinnedNote<unknown>>(
  rows: readonly (HunkRow | CodeRow)[],
  notes: readonly Note[],
): { under: Map<number, Note[]>; unplaced: Note[] } {
  const rowAt = new Map<string, number>()
  rows.forEach((row, index) => {
    const place = row.kind === 'hunk' ? null : linePlace(row)
    const key = place && `${place.side}:${place.line}`
    if (key && !rowAt.has(key)) rowAt.set(key, index)
  })
  const under = new Map<number, Note[]>()
  const unplaced: Note[] = []
  for (const note of notes) {
    const index = rowAt.get(`${note.props.side}:${note.props.line}`)
    if (index === undefined) unplaced.push(note)
    else under.set(index, [...(under.get(index) ?? []), note])
  }
  return { under, unplaced }
}
