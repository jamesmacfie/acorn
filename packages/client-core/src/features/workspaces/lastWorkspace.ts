// The workspace you were in before this one, so one key can bounce between two.
//
// Module state, like the active node and the selected source, because both shells ask the same
// question and neither has a component that outlives every workspace change. Each host reports the
// workspace it has settled on — the desktop derives that from the route, the terminal from its own
// choice — and this file remembers the one before it.
//
// An id and nothing else. The desktop looks the id up against the fleet when the key is pressed
// (host/palette/navigationCommands.ts), so a workspace whose node has come back is found again
// rather than remembered against a node id that was right at the time.

import { createSignal } from 'solid-js'

const [previous, setPrevious] = createSignal<string | null>(null)
let current: string | null = null

/** The workspace before the open one, or null until a second one has been opened. */
export const previousWorkspaceId = previous

/** Say which workspace is open now. Only a change moves the pointer, so the effects that call this
 *  on every render of a derivation cost nothing. */
export function noteWorkspaceVisit(workspaceId: string): void {
  if (workspaceId === current) return
  if (current) setPrevious(current)
  current = workspaceId
}
