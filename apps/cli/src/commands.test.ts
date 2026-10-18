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
    async mutate() {
      throw new Error('unexpected mutation')
    },
    close() {},
  }
}

describe('CLI read projections', () => {
  it('keeps workspace membership and projects on the selected Node', async () => {
    const node = fakeNode({
      '/v1/core/workspaces': [
        { id: 'w', name: 'Default', isDefault: true, sort: 0, projects: [{ id: 'p', name: 'App', sort: 0 }] },
      ],
      '/v1/core/projects': {
        projects: [
          {
            id: 'p',
            name: 'App',
            workspaceId: 'w',
            path: '/srv/app',
            hidden: false,
            vcs: 'git',
            defaultBranch: 'main',
            remoteUrl: null,
          },
          {
            id: 'other',
            name: 'Other',
            workspaceId: 'other',
            path: '/srv/other',
            hidden: false,
            vcs: null,
            defaultBranch: null,
            remoteUrl: null,
          },
        ],
      },
    })
    expect(await runCommand(node, parseCliArgs(['workspace', 'show', 'w']))).toMatchObject({
      kind: 'Workspace',
      nodeId: 'node-one',
      projects: [{ id: 'p' }],
    })
    expect(await runCommand(node, parseCliArgs(['project', 'list', '--workspace', 'w']))).toMatchObject([
      { id: 'p', path: '/srv/app' },
    ])
  })

  it('reads active and archived lists for show and distinguishes missing IDs', async () => {
    const node = fakeNode({
      '/v1/core/tasks': [
        {
          id: 'a',
          projectId: 'p',
          title: 'Active',
          status: 'active',
          branch: null,
          worktreePath: null,
          parentId: null,
        },
      ],
      '/v1/core/tasks?status=archived': [
        {
          id: 'b',
          projectId: 'p',
          title: 'Old',
          status: 'archived',
          branch: null,
          worktreePath: null,
          parentId: null,
          archivedAt: 42,
        },
      ],
    })
    expect(await runCommand(node, parseCliArgs(['task', 'show', 'b']))).toMatchObject({
      id: 'b',
      status: 'archived',
      archivedAt: 42,
    })
    expect(await runCommand(node, parseCliArgs(['task', 'list']))).toHaveLength(1)
    expect(await runCommand(node, parseCliArgs(['task', 'list', '--status', 'all']))).toHaveLength(2)
    await expect(runCommand(node, parseCliArgs(['task', 'show', 'missing']))).rejects.toMatchObject({
      code: 'not_found',
      exitCode: 4,
    })
  })

  it('reports active and installed plugin versions separately', async () => {
    const node = fakeNode({
      '/v1/core/plugins': {
        plugins: [
          {
            name: 'sample',
            state: 'pending-restart',
            running: true,
            disabled: false,
            required: false,
            active: { version: '1.0' },
            installed: { version: '2.0' },
          },
        ],
      },
    })
    expect(await runCommand(node, parseCliArgs(['plugin', 'list']))).toMatchObject([
      { id: 'sample', activeVersion: '1.0', installedVersion: '2.0' },
    ])
  })

  it('does not silently ignore a filter on the wrong command', async () => {
    const node = fakeNode({})
    await expect(runCommand(node, parseCliArgs(['workspace', 'list', '--project', 'p']))).rejects.toMatchObject({
      code: 'usage',
      exitCode: 2,
    })
  })

  it('adds a project without naming a workspace', async () => {
    let body: unknown
    const node = {
      ...fakeNode({}),
      mutate: async (_method: string, _path: string, input: unknown) => {
        body = input
        return { project: { id: 'p', name: 'App', path: '/srv/app', workspaceId: 'w', hidden: false } }
      },
    } as CliNode
    expect(await runCommand(node, parseCliArgs(['project', 'add', '--path', '/srv/app']))).toMatchObject({ id: 'p' })
    expect(body).toEqual({ path: '/srv/app' })
  })

  it('resolves project filters and rejects conflicting filters', async () => {
    const node = fakeNode({
      '/v1/core/projects/p': { id: 'p', workspaceId: 'w' },
      '/v1/p/agents/sessions?workspaceId=w&limit=100': { sessions: [], nextCursor: null },
      '/v1/core/runs': { runs: [], failed: [] },
      '/v1/core/projects': { projects: [{ id: 'p', workspaceId: 'w' }] },
      '/v1/core/tasks': [],
      '/v1/core/tasks?status=archived': [],
    })
    expect(await runCommand(node, parseCliArgs(['agent', 'list', '--project', 'p']))).toEqual([])
    expect(await runCommand(node, parseCliArgs(['run', 'list', '--project', 'p']))).toMatchObject({ workspaceId: 'w' })
    await expect(
      runCommand(node, parseCliArgs(['agent', 'list', '--project', 'p', '--task', 't'])),
    ).rejects.toMatchObject({ code: 'usage', exitCode: 2 })
    await expect(
      runCommand(node, parseCliArgs(['run', 'list', '--project', 'p', '--workspace', 'w'])),
    ).rejects.toMatchObject({ code: 'usage', exitCode: 2 })
  })
})

describe('pairing and devices', () => {
  const launcher = { id: 'device-cli', name: 'Standalone node launcher', createdAt: 1, lastSeenAt: 2, revokedAt: null }
  const phone = { id: 'device-other', name: 'laptop', createdAt: 3, lastSeenAt: null, revokedAt: null }
  function pairingNode() {
    const mutations: [string, string][] = []
    const node: CliNode = {
      ...fakeNode({ '/v1/core/devices': { devices: [phone, launcher] } }),
      endpoint: 'https://127.0.0.1:4317',
      fingerprint: 'ab'.repeat(32),
      deviceId: 'device-cli',
      async mutate(method, path) {
        mutations.push([method, path])
        return path === '/v1/core/pair/start' ? { code: 'pairing-code', expiresInMs: 600_000 } : null
      },
    }
    return { node, mutations }
  }

  it('opens a window with the identity words and closes it', async () => {
    const { node, mutations } = pairingNode()
    const window = await runCommand(node, parseCliArgs(['node', 'pair']))
    expect(window).toMatchObject({
      kind: 'PairingWindow',
      nodeId: 'node-one',
      endpoints: ['https://127.0.0.1:4317'],
      code: 'pairing-code',
    })
    expect((window as { identity: string }).identity.split(' ')).toHaveLength(6)
    expect(await runCommand(node, parseCliArgs(['node', 'pair', '--close']))).toBeUndefined()
    expect(mutations).toEqual([
      ['POST', '/v1/core/pair/start'],
      ['DELETE', '/v1/core/pair'],
    ])
  })

  it('marks this terminal and refuses to revoke it without --force', async () => {
    const { node, mutations } = pairingNode()
    expect(await runCommand(node, parseCliArgs(['node', 'devices']))).toMatchObject([
      { id: 'device-other', thisTerminal: false },
      { id: 'device-cli', thisTerminal: true },
    ])
    await expect(runCommand(node, parseCliArgs(['node', 'revoke', 'device-cli']))).rejects.toMatchObject({
      code: 'revoke_self',
    })
    expect(mutations).toEqual([])
    await runCommand(node, parseCliArgs(['node', 'revoke', 'device-other']))
    await runCommand(node, parseCliArgs(['node', 'revoke', 'device-cli', '--force']))
    expect(mutations).toEqual([
      ['DELETE', '/v1/core/devices/device-other'],
      ['DELETE', '/v1/core/devices/device-cli'],
    ])
  })
})
