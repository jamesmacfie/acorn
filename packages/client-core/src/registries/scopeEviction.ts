// Per-scope state eviction: how a module-level signal learns that a task was archived, a workspace
// was removed, or the active node changed underneath it (docs/state.md § Scope rules).
//
// A state owner registers its own evictor next to the signal it clears, so the two are one edit apart
// and cannot drift.
//
// The lazy-import property is a feature, not a hole: a state module that has not been imported has
// not registered, and has also not accumulated any state, so there is nothing for it to evict.
// Registration and the thing needing eviction come into existence together.
export type ScopeEviction =
  // A task was archived. Anything keyed by taskId should drop that key.
  | { scope: 'task'; taskId: string }
  // A workspace was removed. Anything keyed by workspaceId should drop that key.
  | { scope: 'workspace'; workspaceId: string }
  // The active node changed (docs/state.md § Scope rules). Live rosters clear, since they refetch for
  // the new node within a tick, so clearing costs nothing and keying by node would buy nothing.
  // Durable per-task and per-workspace memory (editor scroll, the active terminal tab, the workspace
  // view) does not clear here: it is keyed by node instead, so switching back restores it.
  | { scope: 'node-switched' }

type Listener = (eviction: ScopeEviction) => void

const listeners = new Set<Listener>()

// Register an evictor. Returns an unsubscribe, which almost nothing uses: a module-level signal lives
// as long as the renderer does, and so does its evictor. Tests use it.
export function onScopeEvicted(listener: Listener): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

// Fired by the shell from the matching runtime event. Every listener runs even if one throws, because
// a half-evicted client is the state this mechanism exists to prevent: one bad evictor must not
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

// Test seam, and the count the shell's own test asserts is non-zero after boot: an empty registry
// would make every eviction silently do nothing.
export const scopeEvictorCount = (): number => listeners.size
export const _resetScopeEvictors = (): void => listeners.clear()
