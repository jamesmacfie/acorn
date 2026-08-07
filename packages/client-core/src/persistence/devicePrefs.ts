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
  PrefKeys.taskLayouts,
  PrefKeys.taskPanesLegacy,
  PrefKeys.editorOpenFiles,
  PrefKeys.prFilters,
  PrefKeys.taskLayoutsScoped,
  PrefKeys.editorOpenFilesScoped,
  PrefKeys.prFiltersScoped,
  PrefKeys.contextSelectionScoped,
  PrefKeys.dockerPrefs,
  PrefKeys.diskWarningAcked,
])

const PREFIX = 'acorn-pref:'

// Exact match, or a scoped slice's key with its id appended.
//
// A scoped slice writes `<declaredKey>:<encodedScopeId>` (persistence/persistedState.ts), so matching the
// whole string alone would classify every per-task layout as a NODE pref and start PUTting pane layouts to
// the node. The prefix scan is the clause that does the work; an earlier version also tried "the segment
// before the first colon", which can never match a scoped device key (all four contain a colon in the
// DECLARED part — `core:task-layouts`, `editor:open-files`, …) and only invited someone to delete the clause
// that matters believing it was covered.
export function isDevicePref(key: string): boolean {
  if (DEVICE_KEYS.has(key)) return true
  for (const candidate of DEVICE_KEYS) if (key.startsWith(`${candidate}:`)) return true
  return false
}

// `null` rather than a throw when there is no storage: this runs in a bare-Node vitest too, and a pref that
// cannot be read is the same as one that was never set.
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readDevicePrefs(): Record<string, string> {
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

export function writeDevicePref(key: string, value: string): void {
  storage()?.setItem(`${PREFIX}${key}`, value)
}

// One-time seed from whatever the node already had, so an existing install keeps its theme, keybindings and
// layouts instead of resetting to defaults on the upgrade. Only fills keys the device does not have yet —
// a value written here since the upgrade always wins.
export function seedDevicePrefs(nodePrefs: Readonly<Record<string, string>>): void {
  const store = storage()
  if (!store) return
  for (const [key, value] of Object.entries(nodePrefs)) {
    if (!isDevicePref(key)) continue
    if (store.getItem(`${PREFIX}${key}`) !== null) continue
    store.setItem(`${PREFIX}${key}`, value)
  }
}

// The merged view every reader sees. Device wins: once a key has moved, the node's copy is a stale leftover
// from before the upgrade and must not resurrect itself.
export const mergePrefs = (
  nodePrefs: Readonly<Record<string, string>>,
  devicePrefs: Readonly<Record<string, string>> = readDevicePrefs(),
): Record<string, string> => ({ ...nodePrefs, ...devicePrefs })
