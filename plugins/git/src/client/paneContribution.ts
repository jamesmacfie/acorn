import { lazy } from 'solid-js'
import { createGitPaneModel, type GitPaneModel } from './paneModel'
import { createChangesModel, type ChangesModel } from './changes/changesModel'
import { changeKey } from './changes/model'
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
  id: GIT_PANE,
  label: 'Git',
  glyph: 'git-branch',
  description: 'Uncommitted changes, history, stashes and worktrees',
  order: 20,
  defaultChord: 'meta+shift+g',
  requires: { plugin: 'git' },
  when: gitAvailable,
  layout: 'list-detail',
  // Held once per task by the host (`paneModel` in client-core). The Changes model is built
  // with the pane, so its selection and commit draft survive a tab switch. Each tab only reads Git
  // while it is the one on screen (`createGitPaneModel`).
  model: (task, pane) => {
    const git = createGitPaneModel(task, pane.shown)
    return {
      ...git,
      changes: createChangesModel(task, {
        shown: () => pane.shown() && git.section() === 'changes',
        paneShown: pane.shown,
      }),
    }
  },
  collapsible: true,
  collapseContent: 'empty',
  // The Changes list reports for its tab, and the list region reports for the others (./TaskGitPane.tsx).
  reportsUsable: true,
  // Other plugins may mark the Git button (`core:pane`). A review, lint or CI plugin knows things about
  // a task's uncommitted work, and this button is where a reader looks before committing.
  statusAnnotations: true,
  // Each tab keeps its own selection, so the key is the open tab's.
  selection: (_task, model) => {
    switch (model.section()) {
      case 'changes': {
        const change = model.changes.selected()
        return change ? changeKey(change) : null
      }
      case 'history':
        return model.commitId()
      case 'stashes':
        return model.stashId()
      case 'worktrees':
        return model.selected()
    }
  },
  regions: { 'list-header': GitPaneHeader, list: GitPaneList, 'list-footer': GitPaneFooter, detail: GitPaneDetail },
}
