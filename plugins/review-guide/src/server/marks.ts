import type { Guide, GuideNote } from '../shared/guide'

/** One row of a change request's diff, as a code host's `diff-line` point keys it. */
export type DiffLineKey = { file: string; line: number; side: 'old' | 'new'; task: string }

/** A mark under a diff row, as the host draws it (docs/plugins/rows-and-annotations.md § Annotations). */
export type DiffLineMark = { key: DiffLineKey; severity: 'info' | 'warn' | 'danger'; text: string; icon: string }

const SEVERITY: Record<GuideNote['tone'], DiffLineMark['severity']> = {
  explain: 'info',
  attention: 'warn',
  risk: 'danger',
}

/** The keys a request names that this route can answer. Anything else is skipped, not refused. */
export const diffLineKeys = (keys: unknown): DiffLineKey[] =>
  (Array.isArray(keys) ? keys : []).filter(
    (key): key is DiffLineKey =>
      typeof key?.file === 'string' &&
      Number.isInteger(key.line) &&
      (key.side === 'old' || key.side === 'new') &&
      typeof key.task === 'string' &&
      key.task !== '',
  )

const place = (file: string, side: string, line: number) => `${file}\0${side}\0${line}`

/** Each note on a row the keys name, as a mark with the note's title. The keys all name the guide's task. */
export function noteMarks(guide: Guide, keys: DiffLineKey[]): DiffLineMark[] {
  const notesAt = new Map<string, GuideNote[]>()
  for (const step of guide.steps) {
    const paths = new Map(step.items.map((item) => [item.id, item.path]))
    for (const note of step.notes) {
      const path = paths.get(note.hunk)
      if (!path) continue
      const at = place(path, note.side, note.line)
      notesAt.set(at, [...(notesAt.get(at) ?? []), note])
    }
  }
  return keys.flatMap((key) =>
    (notesAt.get(place(key.file, key.side, key.line)) ?? []).map((note) => ({
      key,
      severity: SEVERITY[note.tone],
      text: note.title,
      icon: 'sparkles',
    })),
  )
}
