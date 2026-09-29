import { PrefKeys } from './prefKeys'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'

const DEVICE_KEYS: ReadonlySet<string> = new Set<string>([
  PrefKeys.themeFollowSystem,
  PrefKeys.theme,
  PrefKeys.themeLight,
  PrefKeys.themeDark,
  PrefKeys.style,
  PrefKeys.devicePluginsDisabled,
  PrefKeys.keybindings,
  PrefKeys.railOrder,
  PrefKeys.railVisibility,
  PrefKeys.leftCollapsed,
  PrefKeys.diffView,
  PrefKeys.terminalRailDefault,
  PrefKeys.terminalHeight,
  PrefKeys.terminalFontSize,
  PrefKeys.notices,
  PrefKeys.lastPath,
  PrefKeys.lastTask,
  PrefKeys.lastSource,
  PrefKeys.homeTab,
  PrefKeys.agentToolFold,
  PrefKeys.dockerPrefs,
  PrefKeys.changesView,
  PrefKeys.generatePick,
  PrefKeys.editorMode,
  PrefKeys.diskWarningAcked,
  PrefKeys.exclusiveSlots,
  PrefKeys.remoteSlots,
  PrefKeys.notifications,
])

const PREFIX = `acorn-pref:${ACORN_BASELINE}:`

// Exact match, and only exact match. Every key above is an `app`-scope slice, so none of them is
// ever suffixed: a scoped slice writes `<declaredKey>:<encodedScopeId>`
// (persistence/persistedState.ts), and the scoped slices are exactly the four composition kinds
// that now belong to the node they describe (docs/state.md § Scope rules). Unknown means node,
// which is what a per-task layout key needs.
const devicePluginIds = new Set<string>()
export const setDevicePluginIds = (ids: Iterable<string>): void => {
  devicePluginIds.clear()
  for (const id of ids) devicePluginIds.add(id)
}
export const isDevicePref = (key: string): boolean => {
  if (DEVICE_KEYS.has(key)) return true
  const match = /^plugin:([^:]+):/.exec(key)
  return !!match && devicePluginIds.has(match[1])
}

export function removeDevicePluginPrefs(pluginId: string): void {
  const store = storage()
  if (!store) return
  const prefix = `${PREFIX}plugin:${pluginId}:`
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) store.removeItem(key)
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

// Read only the keys this device owns. Node-scoped keys left in storage are never projected into
// the active node's preferences.
export function readDevicePrefs(): Record<string, string> {
  const store = storage()
  if (!store) return {}
  const out: Record<string, string> = {}
  try {
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index)
      if (!key?.startsWith(PREFIX) || !isDevicePref(key.slice(PREFIX.length))) continue
      const value = store.getItem(key)
      if (value !== null) out[key.slice(PREFIX.length)] = value
    }
  } catch {
    return {}
  }
  return out
}

export function writeDevicePref(key: string, value: string): void {
  try {
    storage()?.setItem(`${PREFIX}${key}`, value)
  } catch {
    // Storage can be present but unavailable, for example in a private browsing host.
  }
}

// The merged view every reader sees. An owner's keys only come from that owner's store.
export const mergePrefs = (
  nodePrefs: Readonly<Record<string, string>>,
  devicePrefs: Readonly<Record<string, string>> = readDevicePrefs(),
): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(nodePrefs).filter(([key]) => !isDevicePref(key))),
  ...Object.fromEntries(Object.entries(devicePrefs).filter(([key]) => isDevicePref(key))),
})
