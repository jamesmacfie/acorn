import { afterEach, expect, it, vi } from 'vitest'
import { planWorkspaceViewTransition } from '../../../features/workspaces/workspaceViewTransition'
import type { Task, Workspace } from '@acorn/protocol/api.ts'

const state = vi.hoisted(() => ({ activeNode: 'node-a' as string | null, source: 'home' as string | null }))
vi.mock('../../../infra/node/activeNode', () => ({
  activeNodeId: () => state.activeNode,
  setActiveNode: (nodeId: string) => {
    state.activeNode = nodeId
  },
}))
vi.mock('../../../infra/node/fleet', () => ({
  homeNodeId: () => 'node-a',
  nodes: () => [{ nodeId: 'node-a' }],
}))
vi.mock('../../../features/notifications/toast', () => ({ toast: vi.fn() }))
vi.mock('../../../features/notifications/notifications', () => ({ pushNotice: vi.fn() }))
vi.mock('../../../features/tasks/tasks', () => ({
  setSelectedSource: (source: string | null) => {
    state.source = source
  },
}))

import { contentLinkRegistry } from '../panes/contentLinks'
import { sourceRegistry } from '../sources/sources'
import { openLink, registerAddressHost } from './addressOpening'

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  state.activeNode = 'node-a'
  state.source = 'home'
})

it('keeps a recognised GitHub pull route and its source across a workspace transition', async () => {
  const path = '/p/project-b/pulls/42'
  const rememberedTask = { id: 'remembered', projectId: 'project-b' } as Task
  const destination = { id: 'workspace-b', projects: [{ id: 'project-b' }] } as Workspace
  let location = '/p/project-a'
  let explicitProjectPath: string | undefined

  const source = sourceRegistry.register({
    id: 'pulls',
    order: 1,
    glyph: 'git-pull-request',
    label: 'Pulls',
    routes: [{ id: 'pull-detail', path: '/p/:projectId/pulls/:number', order: 1 }],
  })
  const recognizer = contentLinkRegistry.register({
    id: 'github.pull-request',
    providerId: 'github',
    presentations: ['route'],
    parse: (href) =>
      href === 'https://github.com/acme/repo/pull/42'
        ? { kind: 'pr', owner: 'acme', repo: 'repo', number: '42', item: 'acme/repo#42' }
        : null,
    path: () => path,
  })
  disposers.push(
    () => source.dispose(),
    () => recognizer.dispose(),
  )
  disposers.push(
    registerAddressHost({
      nodeId: 'node-a',
      navigate: (next) => {
        location = next
      },
      openProject: (next, sourceId) => {
        explicitProjectPath = next
        state.source = sourceId
        location = next
      },
      openTask: () => false,
      hasProject: () => true,
      loadProjects: async () => {},
      showPromotion: () => {},
    }),
  )

  const link = 'acorn://node-a/open?url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fpull%2F42'
  expect(await openLink(link)).toEqual({ kind: 'opened' })
  expect(location).toBe(path)
  expect(state.source).toBe('pulls')
  expect(
    planWorkspaceViewTransition({
      workspace: destination,
      selectedSource: state.source,
      activeTaskId: null,
      tasks: [rememberedTask],
      defaultSource: 'home',
      rememberedView: { taskId: rememberedTask.id },
      explicitProjectPath,
    }),
  ).toEqual({ kind: 'keep-project' })
})
