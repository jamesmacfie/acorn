// The workspaces you have been in, most recent first. The first is the one open now, the second is
// where one key bounces back to, and the whole list orders the workspace switcher.
//
// Module state, because neither shell has a component that outlives every workspace change. The
// startup restore hydrates the list before either host reports its settled workspace. Keeping the
// current id too lets an explicit desktop URL count as a new visit after a restart.
//
// Ids and nothing else. The desktop looks an id up against the fleet when it needs one
// (host/palette/navigationCommands.ts), so a workspace whose node has come back is found again
// rather than remembered against a node id that was right at the time.

import { createSignal } from 'solid-js'

export type WorkspaceHistory = { recent: string[] }

// Keeps the saved value well under its slice's byte cap. A workspace past this sorts as never visited.
export const MAX_RECENT_WORKSPACES = 20

const [history, setHistory] = createSignal<WorkspaceHistory>({ recent: [] })

export const workspaceHistory = history

/** Called by the persisted slice before visit reporting starts. */
export function hydrateWorkspaceHistory(value: WorkspaceHistory): void {
  setHistory(value)
}

/** The workspace before the open one, or null until a second one has been opened. */
export const previousWorkspaceId = () => history().recent[1] ?? null

/** The workspace open now, as the host settled it. A signal because the terminal client persists it
 *  and reopens on it (apps/tui/src/chrome/restore.ts); the desktop reopens on its last path instead
 *  and reads nothing here. */
export const currentWorkspaceId = () => history().recent[0] ?? null

/** Say which workspace is open now. Only a change moves it to the front, so the effects that call
 *  this on every render of a derivation cost nothing. */
export function noteWorkspaceVisit(workspaceId: string): void {
  const { recent } = history()
  if (workspaceId === recent[0]) return
  setHistory({ recent: [workspaceId, ...recent.filter((id) => id !== workspaceId)].slice(0, MAX_RECENT_WORKSPACES) })
}

/** Sort a list most recently visited first. Anything never visited keeps its order at the end. */
export function byRecentVisit<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  const rank = new Map(history().recent.map((id, index) => [id, index]))
  const at = (item: T) => rank.get(idOf(item)) ?? rank.size
  // Array sort is stable, so the unvisited tail stays in the order it came in.
  return [...items].sort((a, b) => at(a) - at(b))
}
