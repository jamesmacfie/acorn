// The shell's own state: which overlay is on top, and which workspace is being looked at.
//
// Two signals, and neither of them duplicates one client-core already owns. The active task, the
// selected rail source, the per-task pane layout and the per-workspace view memory are all
// `features/tasks/tasks.ts` and are read from there (docs/state-ownership.md). What is here is what
// the desktop keeps in its composition root and its router, because a terminal has neither.
//
// Session-only. What does survive a run is held elsewhere: which workspace was open, and what was
// open in it, are two persisted slices (./restore.ts), and the flag below is how the rest of the
// shell knows whether that restore has happened yet.

import { createSignal } from 'solid-js'

/** The overlays the shell itself draws. A pane's own `Modal` is not one of these: it is a kit node
 *  and owns its own trap (../kit/grouping.tsx). `trust` is the one nobody opens by hand: the plugin
 *  distribution pass queues a bundle and the shell raises it (../plugins/TrustPrompt.tsx).
 *  `notifications` is the bell's two sections, which on this host have no popover to live in
 *  (./Inbox.tsx). */
export type OverlayName = 'palette' | 'help' | 'quit' | 'trust' | 'workspace' | 'project' | 'notifications'

// A stack rather than one slot, because the topmost is the one that owns the keys and closing it has
// to reveal the one under it. In practice two are rarely open at once — `?` inside the palette types
// a `?` — but "the top of the stack owns the layer" is the rule the traps already keep, and a single
// slot would be a second, quieter rule saying the same thing worse.
const [stack, setStack] = createSignal<readonly OverlayName[]>([])

export const openOverlays = stack

/** What has the keys, or null when the pane does. */
export const topOverlay = (): OverlayName | null => stack()[stack().length - 1] ?? null

/** Open one, or raise it if it is already open. */
export const openOverlay = (name: OverlayName): void => {
  setStack((open) => [...open.filter((entry) => entry !== name), name])
}

export const closeOverlay = (name: OverlayName): void => {
  setStack((open) => open.filter((entry) => entry !== name))
}

export const isOverlayOpen = (name: OverlayName): boolean => stack().includes(name)

// Whether the startup restore has finished, so nothing overwrites a stored view before it has been
// read back (./restore.ts). The shell picks a default source for a workspace the moment its roster
// loads, and that default is not a choice worth remembering over the one the last run recorded.
//
// Stays false when there is nothing to restore from — an unreachable node has no preferences to read
// and none to write either — so this gates recording rather than rendering. Nothing waits on it.
const [placeRestored, setPlaceRestored] = createSignal(false)
export { placeRestored, setPlaceRestored }

// Which workspace the rail is showing.
//
// The desktop derives this from the routed project, because its URL always carries one
// (features/workspaces/activeWorkspace.ts). There is no router here, so the choice is a signal and
// `null` means "follow the active task", which is the same answer the derivation gives when a task is
// open and the only sensible one before anything is.
const [chosenWorkspace, setChosenWorkspace] = createSignal<string | null>(null)
export { chosenWorkspace, setChosenWorkspace }

/** Test seam. Module state outlives a render, so a suite must not inherit the previous one's shell. */
export function _resetChrome(): void {
  setStack([])
  setChosenWorkspace(null)
  setPlaceRestored(false)
}
