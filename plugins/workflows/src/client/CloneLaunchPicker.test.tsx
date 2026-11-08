import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { CloneFollowUpChoice } from '@acorn/plugin-api/client'

const state = vi.hoisted(() => ({
  prefs: {} as Record<string, string>,
  posts: [] as Array<{ launchId: string }>,
  // What the Node answers each wait, in order.
  waits: [] as unknown[],
  opened: vi.fn(),
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: state.prefs }) }))
vi.mock('@acorn/plugin-api/client', () => ({
  PrefKeys: { workflowsCloneDefault: 'workflows_clone_default' },
  prefsOptions: () => ({}),
  readJson: async (path: string) => (path === '/v1/core/tasks' ? [{ id: 't1', projectId: 'p1' }] : state.waits.shift()),
  writeJson: async (_path: string, init: { body: string }) => {
    state.posts.push(JSON.parse(init.body))
    return { launchId: JSON.parse(init.body).launchId, stage: 'cloning' }
  },
}))
vi.mock('./cloneLaunchWorkflows', () => ({
  cloneLaunchesRoute: '/v1/p/workflows/clone-launches',
  cloneLaunchRoute: (id: string) => `/v1/p/workflows/clone-launches/${id}`,
  createCloneLaunchWorkflows: () => ({
    target: () => undefined,
    workflows: () => [{ id: 'user:scan', name: 'Security scan', source: 'user', steps: [] }],
  }),
}))
vi.mock('./runs/runStore', () => ({ openWorkflowRun: state.opened }))

import CloneLaunchPicker from './CloneLaunchPicker'

let dispose = () => {}
afterEach(() => {
  dispose()
  state.prefs = {}
  state.posts = []
  state.waits = []
  state.opened.mockReset()
})

function mount() {
  const host = document.createElement('div')
  let choice: CloneFollowUpChoice | null = null
  dispose = render(
    () => <CloneLaunchPicker nodeId={null} disabled={false} onChange={(next) => (choice = next)} />,
    host,
  )
  return () => choice
}

const request = { url: 'https://example.com/acme/api.git', parentDir: '/work', name: 'api' }

it('fills in the default, and offers nothing for a default that no longer resolves', () => {
  state.prefs = { workflows_clone_default: 'user:gone' }
  expect(mount()()).toBeNull()
  dispose()
  state.prefs = { workflows_clone_default: 'user:scan' }
  expect(mount()()).toMatchObject({ label: 'Clone and run', ready: true })
})

it('opens the run once it starts, and retries a failed start under the same launch ID', async () => {
  state.prefs = { workflows_clone_default: 'user:scan' }
  const choice = mount()
  state.waits = [{ stage: 'failed', failedAt: 'starting', error: 'No agent.', projectId: 'p1', taskId: 't1' }]
  expect(await choice()!.start(request)).toEqual({
    ok: false,
    error: "Cloned, but the workflow didn't start: No agent.",
  })
  expect(choice()!.label).toBe('Retry')
  state.waits = [{ stage: 'started', projectId: 'p1', taskId: 't1', runId: 'r1' }]
  expect(await choice()!.start(request)).toEqual({ ok: true, projectId: 'p1' })
  expect(state.posts.map((post) => post.launchId)).toEqual([state.posts[0]!.launchId, state.posts[0]!.launchId])
  expect(state.opened).toHaveBeenCalledWith({ id: 't1', projectId: 'p1' }, 'r1', expect.any(Function))
})
