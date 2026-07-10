import { AGENT_TOOLS_PERMS_PREF_KEY } from '../../shared/api'

// The complete renderer preference vocabulary. Features import this object instead of spelling
// storage keys so a preference rename or migration has one reviewable boundary.
export const PrefKeys = {
  themeFollowSystem: 'theme_follow_system',
  theme: 'theme',
  themeLight: 'theme_light',
  themeDark: 'theme_dark',
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
  onboarded: 'onboarded',
  agentToolPermissions: AGENT_TOOLS_PERMS_PREF_KEY,
  taskLayoutsScoped: 'core:task-layouts',
  editorOpenFilesScoped: 'editor:open-files',
  prFiltersScoped: 'github:pr-filters',
} as const

export type PrefKey = (typeof PrefKeys)[keyof typeof PrefKeys]

// Canonical descriptor keys for aggregates that used to share one unbounded JSON pref. Scoped
// storage appends an encoded workspace/task id; the old keys above remain read-only fallbacks.
export const PersistedSliceKeys = {
  taskLayouts: PrefKeys.taskLayoutsScoped,
  editorOpenFiles: PrefKeys.editorOpenFilesScoped,
  prFilters: PrefKeys.prFiltersScoped,
} as const
