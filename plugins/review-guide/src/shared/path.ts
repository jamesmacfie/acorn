// The guide as a path a reviewer walks: an overview, one page per step, and a wrap-up. The pane draws
// it, and the Node holds progress to the pages and notes it names.
import type { DiffItem, Guide, GuideNote, GuideProgress } from './guide'
import { hunkRows } from './hunk'

// A rough reading rate. The rail says "~" for that reason.
const LINES_PER_MINUTE = 40

/** A note with the key progress stores it under: its hunk ID, side, and line, joined by colons. A second
 *  note on the same row gets `:2`, so each note is checked on its own. */
export type PathNote = GuideNote & { key: string; path: string }

export type PathStep = {
  /** 1-based, as the reader sees it. */
  number: number
  title: string
  why: string
  /** Null for the hunks the guide left out, which aren't a step the harness chose. */
  kind: 'core' | 'supporting' | null
  items: DiffItem[]
  notes: PathNote[]
  added: number
  removed: number
  minutes: number
}

export const OVERVIEW = 'overview'
export const stepPage = (number: number) => `step-${number}`

const changedLines = (items: DiffItem[]) => {
  const rows = items.flatMap((item) => hunkRows(item.patch))
  return {
    added: rows.filter((row) => row.oldLine === null).length,
    removed: rows.filter((row) => row.newLine === null).length,
  }
}

/** Every step in reading order, then the hunks the guide left out as a step of their own, so each
 *  hunk is on exactly one page. */
export function guidePath(guide: Guide): PathStep[] {
  const steps = [
    ...guide.steps,
    ...(guide.uncovered.length
      ? [{ title: 'Not covered by the guide', why: '', kind: null, items: guide.uncovered, notes: [] }]
      : []),
  ]
  const seen = new Map<string, number>()
  return steps.map((step, index) => {
    const { added, removed } = changedLines(step.items)
    const notes = step.notes.map((note) => {
      const row = `${note.hunk}:${note.side}:${note.line}`
      const count = (seen.get(row) ?? 0) + 1
      seen.set(row, count)
      const path = step.items.find((item) => item.id === note.hunk)?.path ?? note.hunk.split('#')[0]!
      return { ...note, key: count === 1 ? row : `${row}:${count}`, path }
    })
    return {
      number: index + 1,
      title: step.title,
      why: step.why,
      kind: step.kind,
      items: step.items,
      notes,
      added,
      removed,
      minutes: Math.max(1, Math.ceil((added + removed) / LINES_PER_MINUTE)),
    }
  })
}

/** The notes a reader decides on in the wrap-up. Explains notes are context, so they're left out. */
export const openQuestions = (path: PathStep[]) =>
  path.flatMap((step) => step.notes.filter((note) => note.tone !== 'explain').map((note) => ({ note, step })))

/** The wrap-up counts as done once every step is reviewed and every open question is checked. It has
 *  no button of its own, because the guide sends the reader to the pull request to finish. */
export function wrapUpDone(path: PathStep[], progress: GuideProgress): boolean {
  return (
    path.every((step) => progress.pages.includes(stepPage(step.number))) &&
    openQuestions(path).every(({ note }) => progress.notes.includes(note.key))
  )
}
