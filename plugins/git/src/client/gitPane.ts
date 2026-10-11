import { openPane } from '@acorn/plugin-api/client'

/** The task pane's id, which is also what the host writes into `focusedPane`. */
export const GIT_PANE = 'git'

/** The pane's tabs, in strip order. Changes comes first: it's where a task's work lands. */
export const GIT_SECTIONS = [
  { id: 'changes', label: 'Changes' },
  { id: 'history', label: 'History' },
  { id: 'stashes', label: 'Stashes' },
  { id: 'worktrees', label: 'Worktrees' },
] as const

export type GitSection = (typeof GIT_SECTIONS)[number]['id']

export const isGitSection = (id: string): id is GitSection => GIT_SECTIONS.some((section) => section.id === id)

/** Show a task's Git pane on its Changes tab. An intent rather than a signal write, because the pane
 *  may not be mounted yet and the request has to wait until it is. It's the host's `plugin:select`,
 *  so `?pane=git&item=changes` deep-links to the same place. */
export const openChangesTab = (taskId: string): void =>
  openPane(taskId, GIT_PANE, { kind: 'plugin:select', item: 'changes' })
