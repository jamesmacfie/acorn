// The workspace you were in before this one, so one key can bounce between two.
//
// Module state, because neither shell has a component that outlives every workspace change. The
// startup restore hydrates the pair before either host reports its settled workspace. Keeping the
// current id too lets an explicit desktop URL count as a new visit after a restart.
//
// An id and nothing else. The desktop looks the id up against the fleet when the key is pressed
// (host/palette/navigationCommands.ts), so a workspace whose node has come back is found again
// rather than remembered against a node id that was right at the time.

import { createSignal } from 'solid-js'

export type WorkspaceHistory = { current: string | null; previous: string | null }

const [history, setHistory] = createSignal<WorkspaceHistory>({ current: null, previous: null })

export const workspaceHistory = history

/** Called by the persisted slice before visit reporting starts. */
export function hydrateWorkspaceHistory(value: WorkspaceHistory): void {
  setHistory(value)
}

/** The workspace before the open one, or null until a second one has been opened. */
export const previousWorkspaceId = () => history().previous

/** The workspace open now, as the host settled it. A signal because the terminal client persists it
 *  and reopens on it (apps/tui/src/chrome/restore.ts); the desktop reopens on its last path instead
 *  and reads nothing here. */
export const currentWorkspaceId = () => history().current

/** Say which workspace is open now. Only a change moves the pointer, so the effects that call this
 *  on every render of a derivation cost nothing. */
export function noteWorkspaceVisit(workspaceId: string): void {
  const { current: open, previous } = history()
  if (workspaceId === open) return
  setHistory({ current: workspaceId, previous: open ?? previous })
}
