// The Changes button's top-right corner in the pane rail: green when the uncommitted changes only add
// lines, red when they only remove them, half of each for both, and nothing on a clean tree.
//
// Read on core's status poll (taskStatusRevision) rather than a clock of its own, and skipped whenever
// that poll already says the tree is clean, so a clean task costs no read. A task in the project folder
// has no entry in that poll, so it is asked about rather than assumed clean.
import { createSignal } from 'solid-js'
import { taskStatus, taskStatusRevision, type RailMarkerContribution, type RailMarkerDot } from '@acorn/plugin-api/client'
import type { LocalChange } from '@acorn/protocol/localGit.ts'
import { localGitApi } from './changesClient'

/** Which way a task's uncommitted lines lean, or null when there is nothing to say. Untracked and
 *  added files carry no line counts, so their status says they add; a deleted file's says it removes. */
export function changesDot(changes: readonly LocalChange[]): RailMarkerDot | null {
  let added = false
  let removed = false
  for (const change of changes) {
    added ||= (change.additions ?? 0) > 0 || change.status === 'added' || change.status === 'untracked'
    removed ||= (change.deletions ?? 0) > 0 || change.status === 'deleted'
  }
  return added && removed ? 'diff' : added ? 'ok' : removed ? 'bad' : null
}

const LABEL: Partial<Record<RailMarkerDot, string>> = {
  ok: 'Lines added',
  bad: 'Lines removed',
  diff: 'Lines added and removed',
}

const [dots, setDots] = createSignal<Record<string, RailMarkerDot | null>>({})
const askedAt = new Map<string, number>()

// Once per poll per task, however many times the rail redraws in between. A failed read keeps the last
// dot, and the next poll asks again.
function ask(taskId: string, revision: number): void {
  if (askedAt.get(taskId) === revision) return
  askedAt.set(taskId, revision)
  localGitApi.status(taskId).then(
    (status) => setDots((current) => ({ ...current, [taskId]: changesDot(status.changes) })),
    () => {},
  )
}

export const changesRailMarkerContribution: RailMarkerContribution = {
  id: 'changes',
  order: 20,
  markers: (target) => {
    if (target.kind !== 'pane' || target.id !== 'changes') return []
    if (taskStatus(target.taskId)?.dirty === false) return []
    ask(target.taskId, taskStatusRevision())
    const dot = dots()[target.taskId]
    return dot ? [{ id: 'lines', label: LABEL[dot]!, dotTone: dot, placements: ['top-end'] }] : []
  },
}
