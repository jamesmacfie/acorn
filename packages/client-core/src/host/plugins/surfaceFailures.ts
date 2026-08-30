// Surfaces a plugin declared that this device couldn't register (docs/plugins.md § Loaded plugins: the
// client half).
//
// The third failure class, after the roster's load, init and ready reasons. A manifest can declare a
// pane whose id a first-party pane already owns, since contribution ids are un-namespaced by design, or
// a project surface whose route the device re-confines and refuses. Both are caught per surface so the
// rest of the plugin still works, and both used to end at a `console.warn`: the pane simply didn't
// exist, with nothing saying why.
//
// A plain Map rather than a signal, and no Solid import at all, because the only reader is the attention
// source (node/pluginFailures.ts), which is polled. Keyed by plugin and surface so a re-registration
// pass replaces a row instead of appending a duplicate on every roster refetch.
export type SurfaceFailure = { pluginId: string; surface: string; reason: string; at: number }

const failures = new Map<string, SurfaceFailure>()

export function recordSurfaceFailure(pluginId: string, surface: string, error: unknown): void {
  const key = `${pluginId}:${surface}`
  failures.set(key, {
    pluginId,
    surface,
    reason: error instanceof Error ? error.message : String(error),
    // Stamped fresh each pass. This used to read `failures.get(key)?.at ?? Date.now()`, meaning to keep
    // the first sighting, but that was dead code: clearSurfaceFailures() empties the map at the top of
    // every pass, so the lookup never found anything.
    //
    // Left dropped rather than made to work: a pass runs at boot and after a trust decision, not on the
    // roster poll, so the reset is close to invisible. Surviving one needs a second map keyed the same
    // way that clear() doesn't touch.
    at: Date.now(),
  })
}

/** Called at the top of a registration pass, which replaces a plugin's whole contribution set: a surface
 * that registers cleanly this time must not keep reporting the last pass's failure. */
export function clearSurfaceFailures(): void {
  failures.clear()
}

export const surfaceFailures = (): readonly SurfaceFailure[] => [...failures.values()]
