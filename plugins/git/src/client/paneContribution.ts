import { lazy } from 'solid-js'
import { createGitPaneModel, type GitPaneModel } from './paneModel'
import { createChangesModel, type ChangesModel } from './changes/changesModel'
import { GIT_PANE } from './gitPane'
import { allProjects, type PaneLayoutContribution, type Task } from '@acorn/plugin-api/client'

// We hide the pane only for a project we know isn't a Git repository, because it has nothing to show
// there. An unknown project counts as Git: the list may still be loading, and the terminal client
// never installs the lookup. The read isn't reactive, so a project that turns into a Git repository
// gets the pane on the strip's next redraw.
export const gitAvailable = (task: Task): boolean =>
  allProjects().find((project) => project.id === task.projectId)?.vcs !== null

export type GitTaskPaneModel = GitPaneModel & { changes: ChangesModel }

const GitPaneHeader = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneHeader })))
const GitPaneList = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneList })))
const GitPaneFooter = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneFooter })))
const GitPaneDetail = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneDetail })))

export const gitPaneContribution: PaneLayoutContribution<GitTaskPaneModel> = {
  id: GIT_PANE, label: 'Git', glyph: 'git-branch', description: 'Uncommitted changes, history, stashes and worktrees', order: 20,
  defaultChord: 'meta+shift+g', requires: { plugin: 'git' },
  when: gitAvailable,
  layout: 'list-detail',
  // Held once per task by the host (client-core registries/paneModels.ts). The Changes model is built
  // with the pane, so its selection and commit draft survive a tab switch, but it only polls Git while
  // its tab is the one on screen.
  model: (task, pane) => {
    const git = createGitPaneModel(task)
    return { ...git, changes: createChangesModel(task, { shown: () => pane.shown() && git.section() === 'changes' }) }
  },
  collapsible: true,
  collapseContent: 'empty',
  // The Changes list reports for its tab, and the list region reports for the others (./TaskGitPane.tsx).
  reportsUsable: true,
  // Other plugins may mark the Git button (`core:pane`). A review, lint or CI plugin knows things about
  // a task's uncommitted work, and this button is where a reader looks before committing.
  statusAnnotations: true,
  regions: { 'list-header': GitPaneHeader, list: GitPaneList, 'list-footer': GitPaneFooter, detail: GitPaneDetail },
}
