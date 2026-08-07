// Per-scope state eviction: how a module-level signal learns that a task was archived, a workspace was
// removed, or the active node changed underneath it.
//
// The shell used to hold the whole list. apps/desktop/src/app/client/scopedEviction.ts imported ten
// evictors out of five plugins and called them by hand, and its own comments admitted the shape of the
// problem: every new module signal has to remember to add itself, and nothing enforces it. The failure
// is silent and looks like a data bug — node A's agent roster rendered under node B, against ids that
// may collide across nodes by construction.
//
// Inverted here. A state owner registers its own evictor NEXT TO the signal it clears, so the two are
// one edit apart and cannot drift.
//
// The lazy-import property is a feature, not a hole: a state module that has not been imported has not
// registered — and has also not accumulated any state, so there is nothing for it to evict. Registration
// and the thing needing eviction come into existence together.
export type ScopeEviction =
  // A task was archived. Anything keyed by taskId should drop that key.
  | { scope: 'task'; taskId: string }
  // A workspace was removed. Anything keyed by workspaceId should drop that key.
  | { scope: 'workspace'; workspaceId: string }
  // The active node changed. LIVE rosters clear — they refetch for the new node within a tick, so
  // clearing costs nothing and keying by node would buy nothing. Durable per-task and per-workspace
  // memory (editor scroll, the active terminal tab, the workspace view) does NOT clear here: it is
  // keyed by node instead, so switching back restores it.
  | { scope: 'node-switched' }

type Listener = (eviction: ScopeEviction) => void

const listeners = new Set<Listener>()

// Register an evictor. Returns an unsubscribe, which almost nothing uses: a module-level signal lives
// as long as the renderer does, and so does its evictor. Tests use it.
export function onScopeEvicted(listener: Listener): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

// Fired by the shell from the matching runtime event. Every listener runs even if one throws, because a
// half-evicted client is the state this whole mechanism exists to prevent — one bad evictor must not
// strand the other nine.
export function evictScope(eviction: ScopeEviction): void {
  for (const listener of listeners) {
    try {
      listener(eviction)
    } catch (error) {
      console.error('[scope-eviction] evictor failed:', error)
    }
  }
}

// Test seam, and the count the shell's own test asserts is non-zero after boot: an empty registry would
// make every eviction silently do nothing, which is exactly the bug class this replaced.
export const scopeEvictorCount = (): number => listeners.size
export const _resetScopeEvictors = (): void => listeners.clear()
