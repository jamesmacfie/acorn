// Where the reader was left in each transcript, for as long as the window lives.
//
// Here rather than inside the kit's `Timeline`, which used to keep a map of its own. Navigation
// disposes a task's panes on purpose (docs/panes.md § there is no keepAlive), so a place that lives in
// the component is a place lost every time you switch workspace, and a map hidden inside a kit
// component has no owner: nothing can scope it, clear it, or see it. This file is that owner, beside
// the session's draft and its composer state, which are the same shape for the same reason
// (../composer/composerState.ts).
//
// A plain map, not a signal. `Timeline` reads this through an effect to decide what to restore, so a
// store that notified on every write would restart one transcript's restore every time any other one
// moved. Nothing renders from it: it is read when a list opens and written when the reader scrolls.
import { onScopeEvicted } from '@acorn/plugin-api/client'
import type { ReadingPlace } from '@acorn/plugin-api/ui'

// Keyed by the view rather than by the session. A session's own stream, each subagent's run inside it,
// and the same session drawn again in the Workflows run pane are different lists that a reader is in
// different places in (./AgentTranscript.tsx builds the id).
const places = new Map<string, ReadingPlace>()

/** Bounded, and by insertion order. Fifty transcripts of places is nothing; an unbounded map is a
 *  leak, and a reader who has fifty lists on the go is not coming back to the first one. */
const KEPT = 50

export const readingPlace = (viewId: string): ReadingPlace => places.get(viewId) ?? { at: 'live' }

export function rememberReadingPlace(viewId: string, place: ReadingPlace): void {
  places.delete(viewId)
  places.set(viewId, place)
  if (places.size > KEPT) places.delete(places.keys().next().value as string)
}

/** Every view of one session, which is the session's own stream and each of its subagents' runs on
 *  every surface drawing it. Called when the node drops the session (./managedStore.ts). */
export function clearReadingPlaces(sessionId: string): void {
  for (const viewId of [...places.keys()]) {
    if (viewId === sessionId || viewId.endsWith(`:${sessionId}`) || viewId.includes(`:${sessionId}:`)) {
      places.delete(viewId)
    }
  }
}

/** All of them. A session id is one node's, so another node's ids may collide with these. */
export function clearAllReadingPlaces(): void {
  places.clear()
}

// Registered here rather than in the store that holds the sessions, because a module map keyed by a
// node's entities owes its evictor in the same file it is declared in (docs/state-ownership.md).
onScopeEvicted((event) => {
  if (event.scope === 'node-switched') clearAllReadingPlaces()
})
