export type { CodeRow } from './diffModel.ts'

export { synth } from './synth.ts'

// The terminal's StackedDiff places notes by the same rules as the DOM's.
export {
  createPinnedNotes,
  DiffNote,
  DiffNotesProvider,
  keptRows,
  linePlace,
  placeNotes,
  type DiffLinePlace,
  type DiffNoteText,
  type PinnedNote,
} from './diffNotes.ts'
