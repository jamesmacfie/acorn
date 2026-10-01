import { PrefKeys } from './prefKeys'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'

const DEVICE_KEYS: ReadonlySet<string> = new Set<string>([
  PrefKeys.themeFollowSystem,
  PrefKeys.theme,
  PrefKeys.themeLight,
  PrefKeys.themeDark,
  PrefKeys.style,
  PrefKeys.keybindings,
  PrefKeys.railOrder,
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

// Read only the keys this device owns. Node-scoped keys left in storage are never projected into
// the active node's preferences.
export function readDevicePrefs(): Record<string, string> {
  const store = storage()
  if (!store) return {}
  const out: Record<string, string> = {}
  try {
    for (const key of DEVICE_KEYS) {
      const value = store.getItem(`${PREFIX}${key}`)
      if (value !== null) out[key] = value
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
