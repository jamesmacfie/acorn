import { lazy } from 'solid-js'
import { createGitPaneModel, type GitPaneModel } from './paneModel'
import { allProjects, type PaneLayoutContribution } from '@acorn/plugin-api/client'

const GitPaneList = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneList })))
const GitPaneDetail = lazy(() => import('./TaskGitPane').then((module) => ({ default: module.GitPaneDetail })))

export const gitPaneContribution: PaneLayoutContribution<GitPaneModel> = {
  id: 'git', label: 'Git', glyph: 'git-branch', description: 'Task checkout and repository worktrees', order: 30,
  when: (task) => allProjects().some((project) => project.id === task.projectId && project.vcs === 'git'),
  layout: 'list-detail', model: (task) => createGitPaneModel(task),
  regions: { list: GitPaneList, detail: GitPaneDetail },
}
