import { describe, expect, it } from 'vitest'
import type { CliNode } from './node'
import { runCommand } from './commands'
import { parseCliArgs } from './args'

function fakeNode(routes: Record<string, unknown>): CliNode {
  return {
    nodeId: 'node-one',
    endpoint: 'https://node-one.test',
    async get(path) {
      if (!(path in routes)) throw new Error(`unexpected route ${path}`)
      return routes[path]
    },
    async mutate() { throw new Error('unexpected mutation') },
    close() {},
  }
}

describe('CLI read projections', () => {
  it('keeps workspace membership and projects on the selected Node', async () => {
    const node = fakeNode({
      '/v1/core/workspaces': [{ id: 'w', name: 'Default', isDefault: true, sort: 0, projects: [{ id: 'p', name: 'App', sort: 0 }] }],
      '/v1/core/projects': { projects: [
        { id: 'p', name: 'App', workspaceId: 'w', path: '/srv/app', hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null },
        { id: 'other', name: 'Other', workspaceId: 'other', path: '/srv/other', hidden: false, vcs: null, defaultBranch: null, remoteUrl: null },
      ] },
    })
    expect(await runCommand(node, parseCliArgs(['workspace', 'show', 'w']))).toMatchObject({
      kind: 'Workspace', nodeId: 'node-one', projects: [{ id: 'p' }],
    })
    expect(await runCommand(node, parseCliArgs(['project', 'list', '--workspace', 'w']))).toMatchObject([{ id: 'p', path: '/srv/app' }])
  })

  it('reads active and archived lists for show and distinguishes missing IDs', async () => {
    const node = fakeNode({
      '/v1/core/tasks': [{ id: 'a', projectId: 'p', title: 'Active', status: 'active', branch: null, worktreePath: null, parentId: null }],
      '/v1/core/tasks?status=archived': [{ id: 'b', projectId: 'p', title: 'Old', status: 'archived', branch: null, worktreePath: null, parentId: null, archivedAt: 42 }],
    })
    expect(await runCommand(node, parseCliArgs(['task', 'show', 'b']))).toMatchObject({ id: 'b', status: 'archived', archivedAt: 42 })
    expect(await runCommand(node, parseCliArgs(['task', 'list']))).toHaveLength(1)
    expect(await runCommand(node, parseCliArgs(['task', 'list', '--status', 'all']))).toHaveLength(2)
    await expect(runCommand(node, parseCliArgs(['task', 'show', 'missing']))).rejects.toMatchObject({ code: 'not_found', exitCode: 4 })
  })

  it('reports active and installed plugin versions separately', async () => {
    const node = fakeNode({ '/v1/core/plugins': { plugins: [{ name: 'sample', state: 'pending-restart', running: true, disabled: false, required: false, active: { version: '1.0' }, installed: { version: '2.0' } }] } })
    expect(await runCommand(node, parseCliArgs(['plugin', 'list']))).toMatchObject([{ id: 'sample', activeVersion: '1.0', installedVersion: '2.0' }])
  })

  it('does not silently ignore a filter on the wrong command', async () => {
    const node = fakeNode({})
    await expect(runCommand(node, parseCliArgs(['workspace', 'list', '--project', 'p']))).rejects.toMatchObject({ code: 'usage', exitCode: 2 })
  })
})
