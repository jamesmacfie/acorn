import {
  canPairNodes,
  canPickFolder,
  desktopExtras,
  fileDialogs,
  fleetBridge,
  hostPlatform,
  isDesktopHost,
  nodeTransport,
  pluginCustody,
  pluginWebviews,
  previewViews,
  recoveryActions,
  type DesktopExtras,
  type FileDialogs,
  type FleetBridge,
  type NodeTransport,
  type PluginCustody,
  type PluginWebviews,
  type PreviewViews,
  type RecoveryActions,
} from './index'

// The seam's contract as a checker rather than a test, so both ends can run it: this package against
// a mock host, each shell against the object it installs (apps/desktop/src/shell/bridge.test.ts).
// Returning strings instead of calling `expect` keeps a test framework out of src/.
//
// Every group is nullable, so a host that renames a member returns null and the affordance vanishes
// with no compile error. This turns that into a failing test. See docs/testing.md § Test layers.

// A member added to a seam type and left out of the lists below fails `tsc` here rather than
// silently dropping out of the contract.
const members =
  <T extends object>() =>
  <K extends readonly (keyof T)[]>(keys: K & (Exclude<keyof T, K[number]> extends never ? unknown : ['unlisted seam member', Exclude<keyof T, K[number]>])): readonly string[] =>
    keys as readonly string[]

// Groups a host either implements or does not. Absent is a supported product state for all but the
// first two: docs/shell.md § The renderer bridge.
const GROUPS = {
  desktop: {
    // Not an object, so it is checked rather than enumerated: the marker plus the platform string.
    resolve: () => (isDesktopHost() && typeof hostPlatform() === 'string' ? {} : null),
    members: [],
  },
  transport: {
    resolve: nodeTransport,
    members: members<NodeTransport>()(['fetch', 'abort', 'send', 'onFrame', 'onStatus']),
  },
  fleet: {
    resolve: fleetBridge,
    members: members<FleetBridge>()(['list', 'probe', 'pair', 'adopt', 'rename', 'forget', 'reconnect', 'restartLocal', 'tunnelOpen', 'tunnelClose']),
  },
  // Reading the fleet and changing it are different capabilities (platform/index.ts).
  pairing: { resolve: () => (canPairNodes() ? {} : null), members: [] },
  plugins: {
    resolve: pluginCustody,
    members: members<PluginCustody>()(['state', 'cachePut', 'trustRecord', 'devGrant']),
  },
  desktopExtras: {
    resolve: desktopExtras,
    members: members<DesktopExtras>()(['onClosePane', 'onWillQuit']),
  },
  // Checked by its probe alone: calling `pickFolder` would open a dialog on a real host.
  folderPicker: { resolve: () => (canPickFolder() ? {} : null), members: [] },
  // The host's native file dialogs. Absent is not the same as "the verbs are missing": the seam falls
  // back to the page's own input and anchor, so this group says whether the shell took that over.
  files: {
    resolve: fileDialogs,
    members: members<FileDialogs>()(['pick', 'save']),
  },
  recovery: {
    resolve: recoveryActions,
    members: members<RecoveryActions>()(['openDataFolder', 'quit']),
  },
  preview: {
    resolve: previewViews,
    members: members<PreviewViews>()(['ensure', 'setBounds', 'show', 'hide', 'load', 'command', 'evict', 'onEvent']),
  },
  webviews: {
    resolve: pluginWebviews,
    members: members<PluginWebviews>()(['ensure', 'setBounds', 'show', 'hide', 'load', 'command', 'evict', 'onEvent', 'onBlocked']),
  },
} satisfies Record<string, { resolve: () => object | null; members: readonly string[] }>

export type SeamGroup = keyof typeof GROUPS
export const SEAM_GROUPS = Object.keys(GROUPS) as SeamGroup[]

// Every problem with the host installed on `window`, given the groups it claims to implement. Empty
// means the host and the seam agree. Groups not named must be absent: a half-built group is worse
// than none, because consumers probe the group and then call its members.
export function seamProblems(implemented: readonly SeamGroup[]): string[] {
  const problems: string[] = []
  for (const name of SEAM_GROUPS) {
    const group = GROUPS[name]
    let resolved: object | null
    try {
      resolved = group.resolve()
    } catch (error) {
      problems.push(`${name}: resolving the group threw (${String(error)})`)
      continue
    }
    if (!implemented.includes(name)) {
      if (resolved) problems.push(`${name}: resolved on a host that does not implement it`)
      continue
    }
    if (!resolved) {
      problems.push(`${name}: implemented by the host but the seam resolved null`)
      continue
    }
    for (const member of group.members) {
      if (typeof (resolved as Record<string, unknown>)[member] !== 'function') problems.push(`${name}.${member}: not a function`)
    }
  }
  return problems
}
