import { draftsDiffer, type Draft } from './draft'

// Memory only, outside disposable Solid roots. No API, bridge, or grant is retained here.
export type DraftEntry = {
  key: string
  id?: string
  draft: Draft
  baseline: Draft
  revision: number
  failed: boolean
  write?: Promise<void>
}
export type DraftRecovery = { entries: Map<string, DraftEntry>; selected?: string }
const subjects = new Map<string, DraftRecovery>()
let sequence = 0
export const snapshotDraft = (draft: Draft): Draft => structuredClone(draft)
export const entryDirty = (entry: DraftEntry): boolean => entry.failed || draftsDiffer(entry.draft, entry.baseline)
export function createDraftEntry(draft: Draft, id?: string): DraftEntry {
  return { key: id ? `saved:${id}:${++sequence}` : `new:${++sequence}`, id, draft: snapshotDraft(draft), baseline: snapshotDraft(draft), revision: 0, failed: false }
}
export function draftRecovery(subject: string): DraftRecovery {
  let recovery = subjects.get(subject)
  if (!recovery) { recovery = { entries: new Map() }; subjects.set(subject, recovery) }
  return recovery
}
export function clearDraftRecovery(): void { subjects.clear() }
