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
} as const

export type PrefKey = (typeof PrefKeys)[keyof typeof PrefKeys]

// Canonical descriptor keys for aggregates that used to share one unbounded JSON pref. Scoped
// storage appends an encoded workspace/task id; the old keys above remain read-only fallbacks.
export const PersistedSliceKeys = {
  taskLayouts: PrefKeys.taskLayoutsScoped,
  editorOpenFiles: PrefKeys.editorOpenFilesScoped,
  prFilters: PrefKeys.prFiltersScoped,
  contextSelection: PrefKeys.contextSelectionScoped,
} as const
