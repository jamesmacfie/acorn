// Per-device scraps: a draft nobody sent, a fold somebody closed, a tab somebody was last on.
//
// One accessor, because the guard has to be written once. Every caller here is remembering a
// convenience, and a host may have nowhere to remember it: the terminal client runs client-core under
// Node, where `localStorage` is a flagged builtin and undefined without `--localstorage-file`. Four
// call sites reached for it unguarded and the throw took the whole pane down — the PR pane's comment
// box, the agents composer, the create-PR form and every `Fold` with a `persistKey`
// (docs/future/terminal/phase-6-panes-sweep.md).
//
// A private browsing window, a browser set to block site data, and a sandboxed frame all throw on
// access rather than returning undefined, which is why the probe is in a `try`. The same shape
// `infra/persistence/devicePrefs.ts` already used for the same reason; this is the one every other
// caller shares.
//
// Nothing here belongs to the node. What is written is this device's alone and is never read back by
// anything but the surface that wrote it (docs/state-ownership.md).

/** The store, or nothing. Callers usually want the three helpers below instead. */
export function deviceStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** What is under this key, or `null` — which is also the answer when there is nowhere to keep it. */
export function readLocal(key: string): string | null {
  try {
    return deviceStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Keep this. An empty value removes the key, because "nothing to remember" and "remember nothing"
 *  are the same state and a caller should not have to spell both. */
export function writeLocal(key: string, value: string): void {
  const store = deviceStorage()
  if (!store) return
  try {
    if (value) store.setItem(key, value)
    else store.removeItem(key)
  } catch {
    // Out of quota, or a browser that blocks site data. A scrap that cannot be kept is not an error.
  }
}

/** Forget this. */
export function clearLocal(key: string): void {
  writeLocal(key, '')
}
