import { lazy } from 'solid-js'
import { createChangesModel, type ChangesModel } from './changesModel'
import { allProjects, type PaneLayoutContribution, type Task } from '@acorn/plugin-api/client'

// We hide the pane only for a project we know isn't a Git repository, because it has nothing to show
// there. An unknown project counts as Git: the list may still be loading, and the terminal client
// never installs the lookup. The read isn't reactive, so a project that turns into a Git repository
// gets the pane on the strip's next redraw.
export const changesAvailable = (task: Task): boolean =>
  allProjects().find((project) => project.id === task.projectId)?.vcs !== null

// Changes as a `list-detail` pane: the host draws the split, the divider and the drag handle, and these
// four components fill the regions (docs/panes/layout.md § Layout model).
const ChangesHeader = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesHeader }))
const ChangesList = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesList }))
const ChangesFooter = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesFooter }))
const ChangesDiff = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesDiff }))

export const changesPaneContribution: PaneLayoutContribution<ChangesModel> = {
  id: 'changes', label: 'Changes', glyph: 'git-compare', description: 'Files changed since your last commit', order: 20,
  defaultChord: 'meta+shift+g', requires: { plugin: 'changes' },
  when: changesAvailable,
  layout: 'list-detail',
  // The change list, the selection, the diff source and the armed commit confirm, held once per task
  // by the host (client-core registries/paneModels.ts).
  model: (task, pane) => createChangesModel(task, pane),
  collapsible: true,
  collapseContent: 'empty',
  regions: { 'list-header': ChangesHeader, list: ChangesList, 'list-footer': ChangesFooter, detail: ChangesDiff },
}
