import { PrefKeys } from './prefKeys'

// The device-prefs tier (docs/vNext/ui.md § State ownership: "Client owns presentation: selection, layouts,
// pane weights/pins, drawer height, theme/style, keybindings, window geometry, drafts").
//
// Closing the last Phase 1 divergence. Every pref lived in the NODE's flat `/v2/core/prefs` record, which
// was free with one node and wrong with a fleet — so Phase 1 pinned all of them to the HOME node, whatever
// node was active, purely so the theme would not flip on a switch. That works and says the wrong thing:
// these are properties of this installation, not of a machine that happens to hold repos.
//
// ## Which keys move, and why the split is where it is
//
// A key belongs to the DEVICE when its meaning is "how this window looks and behaves". It stays on the NODE
// when its meaning is "how that machine behaves" — agent tool permissions govern what an agent running
// THERE may do, and `startup_context_injection` and `onboarded` are facts about a node's own setup.
//
// The genuinely arguable ones and the call made:
//
//   - `last_path` / `last_task` / `last_source` are device: "what was I looking at" is this window's
//     question. They are also node-SCOPED in content (a task id), which is why the scoped-key change lands
//     with this one — see persistence/persistedState.ts.
//   - `task_layouts` and `editor_open_files` are device for the same reason, and are the keys that made the
//     old arrangement actively unsafe: a remote task's layout was stored on the home node under a bare task
//     id, and two nodes may hold the same task UUID by construction.
//   - `notices` is device: the ring is client-local state that happens to be persisted.
//
// ## Storage
//
// `localStorage`, not IndexedDB. These are small synchronous scalars read during the first paint (the theme
// is applied before anything renders), and the query cache already owns the async tier.
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
])

const PREFIX = 'acorn-pref:'

// A scoped slice appends `:<encodedScopeId>` to its declared key (persistence/persistedState.ts), so the
// membership test has to match the base key rather than the whole string — otherwise every per-task layout
// would be classified as a node pref.
export function isDevicePref(key: string): boolean {
  if (DEVICE_KEYS.has(key)) return true
  const base = key.slice(0, key.indexOf(':') === -1 ? key.length : key.indexOf(':'))
  return DEVICE_KEYS.has(base) || [...DEVICE_KEYS].some((candidate) => key.startsWith(`${candidate}:`))
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
