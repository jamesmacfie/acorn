import { broadcastHeadChanged } from '../notify'

// The last HEAD this node saw per task, so the status poll doubles as the HEAD observer
// (docs/plugins.md § Hearing a core event). Nothing in the tree hooks HEAD directly, and a
// commit from a PTY, an agent, or an outside editor has no hook to catch, so the poll that already
// runs `git status` on every active worktree is the one honest place to notice. The first sighting
// of a task seeds the map without a frame: a fresh node has nothing to compare against, and
// `reconcileWorktrees` seeds every task at boot for that reason.
//
// The poll is the client's 10 s clock plus a re-pull on every `term:status` ping, so an
// in-app commit (changes pane, which pings status) is noticed within one round trip and an
// out-of-app one within ten seconds, while a client is attached. The observer remains driven by
// those client reads.

type Observation = { head: string | null; generation: object }
const observations = new Map<string, Observation>()
let scope = {}
export const taskHeadScope = (): object => scope

// Admit the whole authorized roster before any worker waits on Git. Generations belong to tasks,
// so overlapping disjoint rosters can both publish their observations.
export function admitTaskHead(taskId: string, admittedScope: object): object {
  const generation = {}
  if (admittedScope !== scope) return generation
  const known = observations.get(taskId)
  observations.set(taskId, { head: known?.head ?? null, generation })
  return generation
}

export function noticeTaskHead(taskId: string, generation: object, projectId: string, branch: string | null, head: string | null, dirty: boolean): void {
  const known = observations.get(taskId)
  if (!known || known.generation !== generation || !head) return
  const previous = known.head
  known.head = head
  if (previous && previous !== head) broadcastHeadChanged({ projectId, taskId, branch, head, dirty })
}

export function retireTaskHead(taskId: string, generation?: object): void {
  if (generation && observations.get(taskId)?.generation !== generation) return
  observations.delete(taskId)
}

// Only an authoritative, unfiltered roster can prune other tasks' observations.
export function pruneTaskHeads(taskIds: ReadonlySet<string>, admittedScope: object): void {
  if (admittedScope !== scope) return
  for (const taskId of observations.keys()) if (!taskIds.has(taskId)) retireTaskHead(taskId)
}

export function resetTaskHeads(): void {
  scope = {}
  observations.clear()
}
