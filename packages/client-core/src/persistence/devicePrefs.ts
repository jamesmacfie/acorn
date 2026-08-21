import { nodeIdFromStorageKey } from './persistedState'
import { PrefKeys } from './prefKeys'

const DEVICE_KEYS: ReadonlySet<string> = new Set<string>([
  PrefKeys.themeFollowSystem,
  PrefKeys.theme,
  PrefKeys.themeLight,
  PrefKeys.themeDark,
  PrefKeys.style,
  PrefKeys.keybindings,
  PrefKeys.paneShortcuts,
  PrefKeys.railOrder,
  PrefKeys.diffView,
  PrefKeys.leftCollapsed,
  PrefKeys.terminalRailDefault,
  PrefKeys.terminalHeight,
  PrefKeys.terminalFontSize,
  PrefKeys.notices,
  PrefKeys.lastPath,
  PrefKeys.lastTask,
  PrefKeys.lastSource,
  PrefKeys.homeTab,
  PrefKeys.dockerPrefs,
  PrefKeys.diskWarningAcked,
  PrefKeys.exclusiveSlots,
])

const PREFIX = 'acorn-pref:'

// Exact match, and only exact match. Every key above is an `app`-scope slice, so none of them is
// ever suffixed: a scoped slice writes `<declaredKey>:<encodedScopeId>`
// (persistence/persistedState.ts), and the scoped slices are exactly the four composition kinds
// that now belong to the node they describe (docs/state.md § Scope rules). Unknown means node,
// which is what a per-task layout key needs.
export const isDevicePref = (key: string): boolean => DEVICE_KEYS.has(key)

// `null` rather than a throw when there is no storage: this runs in a bare-Node vitest too, and a pref that
// cannot be read is the same as one that was never set.
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// Every `acorn-pref:` entry this device holds, device-owned or not. Private because the answer to
// "what are this device's preferences" is the filtered view below; the unfiltered one exists only for
// the drain, which is the thing that empties it.
function storedPrefs(): Record<string, string> {
  const store = storage()
  if (!store) return {}
  const out: Record<string, string> = {}
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index)
    if (!key?.startsWith(PREFIX)) continue
    const value = store.getItem(key)
    if (value !== null) out[key.slice(PREFIX.length)] = value
  }
  return out
}

// Filtered, and that filter is load-bearing rather than tidiness. `mergePrefs` lets the device win,
// so a leftover under a key that has since become node-owned would shadow the node's copy forever:
// the user's layouts would look fine and no write from any other client would ever appear.
export function readDevicePrefs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(storedPrefs())) if (isDevicePref(key)) out[key] = value
  return out
}

export function writeDevicePref(key: string, value: string): void {
  storage()?.setItem(`${PREFIX}${key}`, value)
}

// One-time seed from whatever the node already had, so an existing install keeps its theme,
// keybindings and layouts instead of resetting to defaults on the upgrade. Only fills keys the
// device does not have yet: a value written here since the upgrade always wins.
export function seedDevicePrefs(nodePrefs: Readonly<Record<string, string>>): void {
  const store = storage()
  if (!store) return
  for (const [key, value] of Object.entries(nodePrefs)) {
    if (!isDevicePref(key)) continue
    if (store.getItem(`${PREFIX}${key}`) !== null) continue
    store.setItem(`${PREFIX}${key}`, value)
  }
}

// The inverse of `seedDevicePrefs`, for the keys travelling the other way: pane layouts, open-file sets,
// PR filters and context selections describe a node's resources, so they belong in that node's per-user
// prefs where every client that pairs with it can see them (docs/state.md § Scope rules). This device is
// still holding the copy the last release seeded, and `readDevicePrefs` now ignores it, so hand each one
// to the node before dropping it or an upgrade loses the layouts the user built.
//
// The device's value wins over the node's: the node's copy is whatever was there before the previous
// migration seeded the device, and every edit since has landed here.
//
// Only the active node's keys. One device's storage holds every node it has ever looked at, and
// these keys carry the node they describe (`nodeIdFromStorageKey`), so draining the lot here
// would hand a remote node's layouts to whichever node happened to be selected at boot and delete
// them from the only place they existed. The rest wait, untouched, for the fetch that runs while
// their own node is active.
export async function drainMigratedPrefs(
  nodeId: string | null,
  nodePrefs: Readonly<Record<string, string>>,
  put: (key: string, value: string) => Promise<unknown>,
): Promise<Record<string, string>> {
  const store = storage()
  if (!store) return {}
  const drained: Record<string, string> = {}
  for (const [key, value] of Object.entries(storedPrefs())) {
    if (isDevicePref(key)) continue
    // An unqualified straggler is one of the pre-scoped aggregates, which predate node qualification and
    // have no node to wait for. Drained on whichever node is active first, the same guess they carried
    // before the move.
    const owner = nodeIdFromStorageKey(key)
    if (owner !== null && owner !== nodeId) continue
    try {
      if (nodePrefs[key] !== value) await put(key, value)
      drained[key] = value
      store.removeItem(`${PREFIX}${key}`)
    } catch (error) {
      console.warn(`[prefs] could not hand ${key} to the node`, error)
    }
  }
  return drained
}

// The merged view every reader sees. Device wins: once a key has moved, the node's copy is a stale leftover
// from before the upgrade and must not resurrect itself.
export const mergePrefs = (
  nodePrefs: Readonly<Record<string, string>>,
  devicePrefs: Readonly<Record<string, string>> = readDevicePrefs(),
): Record<string, string> => ({ ...nodePrefs, ...devicePrefs })
