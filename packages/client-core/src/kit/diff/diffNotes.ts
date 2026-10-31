// Notes a tree pins under the rows of a `StackedDiff`, shared by both hosts' `StackedDiff`.
//
// A tree's props are data, so a note can't be a prop of the diff. It is a child node, `DiffNote`,
// that draws nothing where it stands: it hands its props to the `StackedDiff` above it, which draws
// it under the row it names. Outside a `StackedDiff` there is nobody to hand them to, so the note is
// omitted, as a node the host doesn't know is.
import { createContext, createSignal, onCleanup, useContext, type Accessor, type JSX } from 'solid-js'
import type { CodeRow, HunkRow } from './diffModel'

/** One line of a diff, named the way a review names it: deleted rows on the old side, everything
 *  else on the new. What a line's ✦ sends, and where a note goes. */
export type DiffLinePlace = { side: 'old' | 'new'; line: number }

export type DiffNoteProps<Children = unknown> = DiffLinePlace & {
  tone?: 'neutral' | 'warn' | 'danger'
  /** The tone's word in the header, such as "Risk". */
  label?: string
  /** Who wrote the note, such as "Claude Code", as the plugin says. */
  author?: string
  /** The plugin that pinned the note. The host sets it, never the plugin, so a reader and an agent
   *  know whose words they are. */
  from?: string
  /** One line, and all a folded note shows. */
  title?: string
  /** Markdown, drawn under the title. Text rather than children, so the host can hand the note to an
   *  agent as the opening message of the line's conversation. */
  body?: string
  /** Controlled mode, as `Fold`'s: with `onOpenChange` the caller owns the fold, and `open` defaults
   *  to true. Without it the note keeps its own fold and starts open. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The plugin's own buttons, under the body. */
  children?: Children
}

/** What a note says, without its fold or buttons: what a line conversation stores and sends. */
export type DiffNoteText = Pick<DiffNoteProps, 'tone' | 'label' | 'author' | 'from' | 'title' | 'body'>

/** A note as its `StackedDiff` holds it. The fold lives with the note's node, so it survives the
 *  note moving to another row. */
export type PinnedNote<Children = unknown> = {
  props: DiffNoteProps<Children>
  folded: Accessor<boolean>
  setFolded: (folded: boolean) => void
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
  const [local, setLocal] = createSignal(false)
  const folded = () => (props.onOpenChange ? props.open === false : local())
  const setFolded = (next: boolean) => (props.onOpenChange ? props.onOpenChange(!next) : setLocal(next))
  if (pin) onCleanup(pin({ props, folded, setFolded }))
  return null
}

/** A line of a task's change request, as a tree's `StackedDiff` hands it to the host's agent card for
 *  that request (`changeRequestLineCard`). One card per line holds the line's conversation, and its
 *  notes are the conversation's opening messages. */
export type ChangeRequestLineProps = DiffLinePlace & {
  path: string
  /** The line's code, which the conversation quotes. */
  quote: string
  notes: readonly PinnedNote<JSX.Element>[]
  /** Open on a line with no note and no conversation yet, as ✦ does. */
  open: boolean
  onClose: () => void
  /** Drawn instead of a card, such as for a file the change request doesn't have. */
  fallback: JSX.Element
}

export const linePlace = (row: CodeRow): DiffLinePlace | null => {
  const line = row.kind === 'delete' ? row.oldNo : row.newNo
  return line == null ? null : { side: row.kind === 'delete' ? 'old' : 'new', line }
}

/** With `context`, the indices of the rows a `StackedDiff` keeps: each noted row and `context` code
 *  rows either side of it, with no hunk headers. Undefined keeps every row. */
export function keptRows(
  rows: readonly (HunkRow | CodeRow)[],
  noted: Iterable<number>,
  context: number | undefined,
): Set<number> | undefined {
  if (context === undefined) return undefined
  const code = rows.flatMap((row, index) => (row.kind === 'hunk' ? [] : [index]))
  const kept = new Set<number>()
  for (const index of noted) {
    const at = code.indexOf(index)
    for (const near of code.slice(Math.max(0, at - context), at + context + 1)) kept.add(near)
  }
  return kept
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
