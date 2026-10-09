import type { ClientPlugin } from '@acorn/plugin-api/client'
import { lazy } from 'solid-js'
import { gitSourceContribution } from './sourceContribution'
import { gitPaneContribution } from './paneContribution'
const GitSettings = lazy(() => import('./GitSettings'))
const GitAppearance = lazy(() => import('./GitSettings').then((module) => ({ default: module.GitAppearanceSettings })))

export const gitClientPlugin: ClientPlugin = {
  name: 'git',
  init(ctx) {
    ctx.sources.register(gitSourceContribution)
    ctx.panes.register(gitPaneContribution)
    ctx.settingsPages.register({ id: 'git', label: 'Git', category: 'features', scope: 'node', icon: 'git-branch', order: 42,
      requires: { plugin: 'git' }, keywords: ['author', 'email', 'pull', 'rebase', 'fetch', 'identity'],
      sections: [{ id: 'identity', label: 'Git identity', rows: ['Repository', 'Write scope', 'Effective author', 'Effective email', 'Author name', 'Author email'] },
        { id: 'behavior', label: 'Git behavior', rows: ['Pull strategy', 'Auto-fetch'] }], component: GitSettings })
    ctx.settingsPages.register({ id: 'git-display', label: 'Git display', category: 'features', scope: 'device', icon: 'git-branch', order: 43,
      requires: { plugin: 'git' }, keywords: ['graph', 'diff', 'unified', 'split'],
      sections: [{ id: 'display', label: 'Git display', rows: ['History graph', 'Diff presentation'] }], component: GitAppearance })
  },
}
