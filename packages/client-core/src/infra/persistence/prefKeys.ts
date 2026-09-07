import { AGENT_TOOLS_PERMS_PREF_KEY } from '@acorn/protocol/api.ts'

// The complete renderer preference vocabulary. Features import this object instead of spelling
// storage keys so a preference rename or migration has one reviewable boundary.
export const PrefKeys = {
  themeFollowSystem: 'theme_follow_system',
  theme: 'theme',
  themeLight: 'theme_light',
  themeDark: 'theme_dark',
  // Visual style, the appearance axis orthogonal to theme. One key rather than four, because there is
  // no OS signal to follow and nobody wants square panes by day and rounded by night.
  style: 'style',
  lastTask: 'last_task',
  lastPath: 'last_path',
  lastSource: 'last_source',
  // Which workspace the terminal client was showing when it was last closed, so `acorn` reopens on
  // it (apps/tui/src/chrome/restore.ts). The node's, not the device's: the terminal has no
  // `localStorage`, so a device key would be written nowhere and read back as nothing.
  lastWorkspace: 'last_workspace',
  taskLayouts: 'task_layouts',
  taskPanesLegacy: 'task_panes',
  notices: 'notices',
  editorOpenFiles: 'editor_open_files',
  prFilters: 'pr_filters',
  leftCollapsed: 'left_collapsed',
  keybindings: 'keybindings',
  paneShortcuts: 'pane_shortcuts',
  diffView: 'diff_view',
  railOrder: 'rail_order',
  terminalRailDefault: 'term_rail_default',
  terminalHeight: 'term_height',
  terminalFontSize: 'term_font_size',
  startupContextInjection: 'startup_context_injection',
  onboarded: 'onboarded',
  agentToolPermissions: AGENT_TOOLS_PERMS_PREF_KEY,
  // How a tool call's disclosure starts out in an agent transcript, and the reader's last toggle when
  // the setting is `sticky` (plugins/agents/src/client/toolFoldPrefs.ts). A JSON `{ mode, last }` in
  // one key, because the remembered toggle is only meaningful next to the mode that reads it.
  //
  // The device's, like `theme` and `diffView`. It describes how this screen draws a transcript, not
  // anything about the node the session ran on.
  agentToolFold: 'agent_tool_fold',
  dockerPrefs: 'docker_prefs',
  // How the Changes pane draws its file list: list or tree, the sort inside a flat list, and what the
  // rows are grouped by (plugins/changes/src/client/changesPrefs.ts). One JSON blob in one key, like
  // `docker_prefs`, because the list reads all three together.
  //
  // The device's, like `diff_view` beside it. It is about the person reading the list, not about the
  // worktree the list is of.
  changesView: 'changes_view',
  // Which model connection the Changes pane's commit-message button spends, and which model on it
  // (plugins/changes/src/client/changesPrefs.ts). A JSON `{ connectionId, modelId }` in one key, like
  // `changes_view` above, because the model is only meaningful beside the connection that serves it.
  //
  // The device's, and this one is not a preference about drawing: the connections a node offers are
  // the same everywhere, but which of them you want to spend is yours, and it should not follow you
  // to a machine where you were working on somebody else's budget.
  changesGenerateConnection: 'changes_generate_connection',
  // Which editor the editor pane's file view mounts: the graphical one, or `$EDITOR` in a throwaway
  // PTY (plugins/editor/src/client/editorPrefs.ts). The device's, like `theme`: it names a program
  // installed on this machine, and the other client paired with the same node may not have it.
  editorMode: 'editor_mode',
  taskLayoutsScoped: 'core:task-layouts',
  // Where you were looking in each workspace, one key per workspace (features/tasks/tasks.ts).
  // The node's, like the pane layouts above and for the same reason: it is keyed by that node's
  // workspace ids, and both clients paired with the node should return you to the same place.
  workspaceViewsScoped: 'core:workspace-views',
  editorOpenFilesScoped: 'editor:open-files',
  prFiltersScoped: 'github:pr-filters',
  contextSelectionScoped: 'context:section-selection',
  // Which nodes' disk-encryption warnings this device has been shown (docs/security.md § Filesystem
  // and backup). A JSON array of nodeIds in one key, because a key per node would need a scoped slice
  // and an eviction rule for a value that is three booleans.
  //
  // The device's, not the node's. A second machine paired with the same node has never seen the
  // warning and should get it.
  diskWarningAcked: 'disk_warning_acked',
  // Which plugin, if any, the owner picked to draw each designated core surface
  // (registries/exclusiveSlots.ts). A JSON `{ slot: pluginId }` map in one key, like
  // `disk_warning_acked`, because a key per slot would need a registration and an eviction rule.
  //
  // The device's, like `theme` and `style`. The plugin behind the choice may not be installed on the
  // other machine paired with the same node.
  exclusiveSlots: 'exclusive_slots',
  // Which plugin, if any, the owner picked to fill each `replace` slot when two matched the same key
  // (plugins/tree/arbitration.ts). The same one-key-holds-all shape as `exclusive_slots` above and for
  // the same reason, and the device's for the same reason too: the plugin behind a pick may not be
  // installed on the other machine paired with this node.
  remoteSlots: 'remote_slots',
  // User-composed panel definitions and where they are placed (docs/state.md § Scope rules,
  // dashboards/persist.ts). The node's, because a panel describes that node's resources, so every
  // client paired with the node renders the board its owner built.
  dashboards: 'dashboards',
  // Which Home dashboard this screen is reading (dashboards/homeTab.ts). The device's, unlike the
  // composition above. The board belongs to the node, but which tab you are on is view state, and
  // syncing it would move another machine's screen under its owner.
  homeTab: 'home_tab',
  // Which notification channels and which events are on (features/notifications/settings.ts). One
  // JSON blob in one key, like `docker_prefs`, because the gate reads all six together.
  //
  // The device's, like `theme`: a sound on this machine is not a fact about the node, and the other
  // client paired with the same node may not even be able to make one.
  notifications: 'notifications',
} as const

export type PrefKey = (typeof PrefKeys)[keyof typeof PrefKeys]

export const PersistedSliceKeys = {
  taskLayouts: PrefKeys.taskLayoutsScoped,
  editorOpenFiles: PrefKeys.editorOpenFilesScoped,
  prFilters: PrefKeys.prFiltersScoped,
  contextSelection: PrefKeys.contextSelectionScoped,
  workspaceViews: PrefKeys.workspaceViewsScoped,
} as const
