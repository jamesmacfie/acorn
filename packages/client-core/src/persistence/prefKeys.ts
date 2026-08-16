import { AGENT_TOOLS_PERMS_PREF_KEY } from '@acorn/protocol/api.ts'

// The complete renderer preference vocabulary. Features import this object instead of spelling
// storage keys so a preference rename or migration has one reviewable boundary.
export const PrefKeys = {
  themeFollowSystem: 'theme_follow_system',
  theme: 'theme',
  themeLight: 'theme_light',
  themeDark: 'theme_dark',
  // Visual style — the appearance axis orthogonal to theme. One key, not four: unlike light/dark
  // there is no OS signal to follow, and nobody wants square panes by day and rounded by night.
  style: 'style',
  lastTask: 'last_task',
  lastPath: 'last_path',
  lastSource: 'last_source',
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
  dockerPrefs: 'docker_prefs',
  taskLayoutsScoped: 'core:task-layouts',
  editorOpenFilesScoped: 'editor:open-files',
  prFiltersScoped: 'github:pr-filters',
  contextSelectionScoped: 'context:section-selection',
  // Which nodes' disk-encryption warnings this DEVICE has already been shown (docs/data-layer.md
  // § Backup: "the app surfaces a one-time warning if the disk isn't encrypted"). A JSON array of
  // nodeIds in ONE key rather than a key per node: the fleet is small, and a key-per-node scheme would
  // need a scoped slice and an eviction rule for a value that is three booleans.
  //
  // The DEVICE's, not the node's, and that is the substantive choice. "Have I shown you this?" is a
  // fact about this installation of the app — a second machine paired with the same node has never seen
  // the warning and should get it.
  diskWarningAcked: 'disk_warning_acked',
  // Which plugin, if any, the owner picked to draw each designated core surface
  // (registries/exclusiveSlots.ts). A JSON `{ slot: pluginId }` map in ONE key rather than a key per
  // slot, the same shape `disk_warning_acked` takes: the designated list is short, and a key per member
  // would need a registration and an eviction rule for a value that is one string.
  //
  // The DEVICE's, like `theme` and `style` beside it. Which list a person looks at is a property of the
  // screen they are looking at, and the plugin behind the choice may not even be installed on the other
  // machine paired with the same node.
  exclusiveSlots: 'exclusive_slots',
  // User-composed panel definitions and where they are placed (dashboards/persist.ts). The NODE's,
  // not the device's: a panel describes that node's resources, so it follows the resource and every
  // client paired with the node renders the board its owner built.
  dashboards: 'dashboards',
} as const

export type PrefKey = (typeof PrefKeys)[keyof typeof PrefKeys]

export const PersistedSliceKeys = {
  taskLayouts: PrefKeys.taskLayoutsScoped,
  editorOpenFiles: PrefKeys.editorOpenFilesScoped,
  prFilters: PrefKeys.prFiltersScoped,
  contextSelection: PrefKeys.contextSelectionScoped,
} as const
