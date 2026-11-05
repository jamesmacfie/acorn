// Clone runs: the Node clones a Git URL in the background and registers the folder as a project
// (docs/workspaces-and-tasks/clone-runs.md). A clone can take far longer than one
// request may, so a client starts it with a POST and reads the outcome with GETs.

export type CloneResult = { ok: true; projectId: string } | { ok: false; error: string }

// What the Node knows about one clone. `none` means it holds no record: the ID is wrong, the Node
// restarted since, or the finished answer expired.
export type CloneRun =
  | { state: 'running'; elapsedMs: number }
  | { state: 'finished'; result: CloneResult }
  | { state: 'none' }

export type CloneRunStart = { cloneId: string; state: 'running' }

// The longest a client asks the Node to hold one wait open. It stays under the broker's 30-second
// request deadline.
export const CLONE_RUN_WAIT_MS = 20_000

const LOST_CLONE =
  'The Node lost track of this clone, which happens when it restarts. Check the folder, then clone again or add it as a project.'

/** Waits for a clone the caller has started, one bounded request at a time. */
export async function cloneOutcome(wait: () => Promise<CloneRun>): Promise<CloneResult> {
  let run = await wait()
  while (run.state === 'running') run = await wait()
  return run.state === 'finished' ? run.result : { ok: false, error: LOST_CLONE }
}
