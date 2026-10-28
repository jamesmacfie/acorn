import { QueryClient } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { integrationsRoute, projectsRoute, tasksRoute, workspaceExternalProjectsRoute } from '@acorn/protocol/api.ts'
import { contentLinkRegistry } from '@acorn/plugin-api/testkit/client'
import { projectsKey, tasksKey, workspaceExternalProjectsKey, type Task } from '@acorn/plugin-api/client'
import type { Integration } from '@acorn/protocol/api.ts'
import type { PluginRefResolution } from '@acorn/protocol/refResolvers.ts'
import { pullRoute, type PullDetail } from '../shared/api'
import { activeTaskForPull, githubPullPromotion, linearConnectionForProject, promotePullToTask } from './pullTasks'

const requests = vi.hoisted(() => ({
  routes: [] as string[],
  responses: new Map<string, unknown>(),
  creates: 0,
  resolve: vi.fn<(identifiers: readonly string[]) => Promise<PluginRefResolution[]>>(async () => []),
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  readJson: async (route: string) => {
    requests.routes.push(route)
    if (!requests.responses.has(route)) throw new Error(`No test response for ${route}`)
    return requests.responses.get(route)
  },
  // Linear itself is stubbed; which identifiers get asked about is what these tests check.
  refResolutionsOptions: (_providerId: string, identifiers: readonly string[]) => ({
    queryFn: () => requests.resolve(identifiers),
  }),
  createTask: async () => {
    requests.creates++
    throw new Error('Unexpected task creation')
  },
}))

afterEach(() => {
  requests.routes = []
  requests.responses.clear()
  requests.creates = 0
  requests.resolve.mockReset().mockResolvedValue([])
})

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Pull task',
  icon: null,
  origin: 'manual',
  projectId: 'project-1',
  branch: 'feature',
  github: { owner: 'acme', name: 'widget' },
  worktreePath: null,
  pullNumber: 42,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
  ...overrides,
})

describe('pull task promotion', () => {
  it('recognises any active task whose primary is the pull', () => {
    const existing = task()
    expect(
      activeTaskForPull(
        [task({ id: 'archived', status: 'archived' }), task({ id: 'other-project', projectId: 'project-2' }), existing],
        'project-1',
        42,
      ),
    ).toBe(existing)
  })

  it('returns a cached task instead of creating a duplicate', async () => {
    const queryClient = new QueryClient()
    const existing = task()
    queryClient.setQueryData(tasksKey, [existing])

    await expect(
      promotePullToTask(queryClient, {
        owner: 'acme',
        repo: 'widget',
        number: '42',
        projectId: 'project-1',
        headRef: 'feature',
      }),
    ).resolves.toBe(existing)
  })

  it('requires a head branch', async () => {
    await expect(
      promotePullToTask(new QueryClient(), {
        owner: 'acme',
        repo: 'widget',
        number: '42',
        projectId: 'project-1',
        headRef: ' ',
      }),
    ).rejects.toThrow(/head branch/)
  })
})

const linear = (id: string): Integration => ({
  id,
  providerId: 'linear',
  label: `Linear · ${id}`,
  status: 'connected',
  authKind: 'api-key',
  account: null,
  scopes: [],
  capabilities: {},
  createdAt: 0,
  updatedAt: 0,
})

// The project map is seeded straight into the cache, the same way the promotion path reads it.
const clientWith = (mappings: { integrationId: string; externalId: string; projectId?: string }[]) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(projectsKey, [
    { id: 'project-1', name: 'Widget', path: null, workspaceId: 'ws-1', sort: 0, hidden: false, color: null },
  ])
  queryClient.setQueryData(workspaceExternalProjectsKey('ws-1'), { projects: mappings })
  return queryClient
}

describe('attributing a pull request reference to a Linear connection', () => {
  it('takes the only connected Linear without consulting the map', async () => {
    // No projects and no mappings in this cache, so answering at all proves the map was not needed.
    await expect(linearConnectionForProject(new QueryClient(), 'project-1', [linear('one')])).resolves.toBe('one')
  })

  it('has no connection to name when no Linear is connected', async () => {
    await expect(linearConnectionForProject(new QueryClient(), 'project-1', [])).resolves.toBeNull()
  })

  it('lets the project map pick between two workspaces', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a' },
      { integrationId: 'unmapped-elsewhere', externalId: 'lin-b' },
    ])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')])).resolves.toBe(
      'work',
    )
  })

  it('counts a link that names this project as well as one that names the whole workspace', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a', projectId: 'project-1' },
      { integrationId: 'side', externalId: 'lin-b', projectId: 'project-2' },
    ])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')])).resolves.toBe(
      'work',
    )
  })

  it('refuses to guess when the repo follows both Linears', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a' },
      { integrationId: 'side', externalId: 'lin-b' },
    ])
    await expect(
      linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]),
    ).resolves.toBeNull()
  })

  it('refuses to guess when the repo follows neither', async () => {
    const queryClient = clientWith([])
    await expect(
      linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]),
    ).resolves.toBeNull()
  })
})

describe('the GitHub source promotion for an Acorn link', () => {
  const target = { kind: 'pr', owner: 'acme', repo: 'widget', number: '42', item: 'acme/widget#42' }
  const detail: PullDetail = {
    pull: {
      number: 42,
      title: 'Fix deploy',
      state: 'open',
      draft: false,
      author: 'james',
      headRef: 'feature/deploy',
      baseRef: 'main',
      updatedAt: 0,
      mergeable: null,
      mergeStateStatus: null,
      autoMergeEnabled: false,
      body: 'Fixes https://linear.app/acme/issue/ENG-42/fix-deploy',
      headSha: 'abc',
    },
    labels: [],
    reviews: [],
    requestedReviewers: [],
    comments: [],
    commits: [],
    checks: [],
    threads: [],
  }

  it('finds an active task by project and pull number before reading PR detail', async () => {
    const existing = task({ id: 'right-project' })
    requests.responses.set(tasksRoute, [task({ id: 'wrong-project', projectId: 'other' }), existing])

    await expect(githubPullPromotion.existingTask?.(target, 'project-1')).resolves.toBe(existing)
    expect(requests.routes).toEqual([tasksRoute])
  })

  it('resolves the PR once and seeds its title, head branch, and unambiguous Linear reference without writing', async () => {
    requests.responses.set(pullRoute('acme', 'widget', '42'), detail)
    requests.responses.set(integrationsRoute, { integrations: [linear('work'), linear('side')] })
    requests.responses.set(projectsRoute, { projects: [{ id: 'project-1', workspaceId: 'ws-1' }] })
    requests.responses.set(workspaceExternalProjectsRoute('ws-1'), {
      projects: [
        { integrationId: 'work', externalId: 'linear-work', projectId: 'project-1' },
        { integrationId: 'side', externalId: 'linear-side', projectId: 'elsewhere' },
      ],
    })
    const recogniser = contentLinkRegistry.register({
      id: 'linear.test.issue',
      providerId: 'linear',
      parse: (url) =>
        url.startsWith('https://linear.app/acme/issue/ENG-42') ? { kind: 'linear.issue', item: 'ENG-42' } : null,
    })
    try {
      const pull = await githubPullPromotion.fromContentLink?.(target, 'project-1')
      expect(pull).toMatchObject({ title: 'Fix deploy', headRef: 'feature/deploy' })
      const seed = await githubPullPromotion.prepare(pull!, {
        projectId: 'project-1',
        branch: '',
      })
      expect(seed).toMatchObject({
        title: 'Fix deploy',
        branch: 'feature/deploy',
        pullNumber: 42,
        links: [
          {
            connectionId: 'work',
            identifier: 'ENG-42',
            ref: {
              displayId: 'ENG-42',
              url: 'https://linear.app/acme/issue/ENG-42/fix-deploy',
            },
          },
        ],
      })
      expect(requests.routes).toEqual([
        pullRoute('acme', 'widget', '42'),
        integrationsRoute,
        projectsRoute,
        workspaceExternalProjectsRoute('ws-1'),
      ])
      expect(requests.creates).toBe(0)
    } finally {
      recogniser.dispose()
    }
  })

  it('reads the head branch of a search hit rather than leaving the modal to invent one', async () => {
    requests.responses.set(projectsRoute, {
      projects: [{ id: 'project-1', github: { owner: 'acme', name: 'widget', repoId: null } }],
    })
    requests.responses.set(pullRoute('acme', 'widget', 42), detail)
    requests.responses.set(integrationsRoute, { integrations: [] })
    const hit = { ...detail.pull!, headRef: null, baseRef: null }

    await expect(githubPullPromotion.prepare(hit, { projectId: 'project-1', branch: '' })).resolves.toMatchObject({
      branch: 'feature/deploy',
      pullNumber: 42,
    })
  })

  describe('with the ticket named only by the branch', () => {
    const branchPull = {
      ...detail.pull!,
      headRef: 'jordan/sec-354-first-time-google-sign-in',
      body: 'Closes SEC-354.',
    }
    const prepare = () => {
      requests.responses.set(integrationsRoute, { integrations: [linear('work')] })
      return githubPullPromotion.prepare(branchPull, { projectId: 'project-1', branch: '' })
    }

    it('links the ticket once Linear confirms it', async () => {
      requests.resolve.mockResolvedValue([
        {
          providerId: 'linear',
          identifier: 'SEC-354',
          label: 'Google sign-in joins the wrong account',
          url: 'https://linear.app/runn/issue/SEC-354',
        },
      ])
      await expect(prepare()).resolves.toMatchObject({
        links: [
          {
            connectionId: 'work',
            identifier: 'SEC-354',
            ref: { displayId: 'SEC-354', url: 'https://linear.app/runn/issue/SEC-354' },
          },
        ],
      })
      expect(requests.resolve).toHaveBeenCalledWith(['SEC-354'])
    })

    it('leaves an unconfirmed fragment out, and still creates the task when Linear fails', async () => {
      await expect(prepare()).resolves.toMatchObject({ links: [] })
      requests.resolve.mockRejectedValue(new Error('provider_not_connected'))
      await expect(prepare()).resolves.toMatchObject({ links: [] })
    })
  })
})
