// A dot for a task's uncommitted changes, on its row in the task rail and in the top-right corner of
// the Changes button in the pane rail: green when the changes only add lines, red when they only
// remove them, half of each for both. Nothing on a clean tree, and nothing outside a git repo, where
// the status read comes back empty.
//
// Read on core's status poll (taskStatusRevision) rather than a clock of its own, and skipped whenever
// that poll already says the tree is clean, so a clean task costs no read. A task in the project folder
// has no entry in that poll, so it is asked about rather than assumed clean.
import { createSignal } from 'solid-js'
import {
  taskStatus,
  taskStatusRevision,
  type RailMarkerContribution,
  type RailMarkerDot,
} from '@acorn/plugin-api/client'
import type { LocalChange } from '@acorn/protocol/localGit.ts'
import { localGitApi } from './changesClient'
import { GIT_PANE } from '../gitPane'

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
  ok: 'Uncommitted changes: lines added',
  bad: 'Uncommitted changes: lines removed',
  diff: 'Uncommitted changes: lines added and removed',
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
    const taskId =
      target.kind === 'task' ? target.id : target.kind === 'pane' && target.id === GIT_PANE ? target.taskId : null
    if (!taskId || taskStatus(taskId)?.dirty === false) return []
    ask(taskId, taskStatusRevision())
    const dot = dots()[taskId]
    if (!dot) return []
    // A task row's top corners go to notices and the pin, so its dot takes a bottom one.
    return [
      {
        id: 'lines',
        label: LABEL[dot]!,
        dotTone: dot,
        placements: target.kind === 'task' ? ['bottom-end', 'bottom-start'] : ['top-end'],
      },
    ]
  },
}
