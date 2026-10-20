import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { AGENT_SESSION_KEY, AGENT_SESSION_POINT } from '@acorn/protocol/extensionPoints.ts'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '@acorn/plugin-api/testkit/client'
import type { AgentSession } from '../../contract/wire.ts'

// What the center's queries and store answer. Empty until a test fills them.
const data = vi.hoisted(() => ({
  projectId: undefined as string | undefined,
  tasks: [] as unknown[],
  workspaces: [] as unknown[],
  sessions: [] as unknown[],
}))

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {}, useParams: () => ({ projectId: data.projectId }) }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    data: options().queryKey[0] === 'workspaces' ? data.workspaces : data.tasks,
  }),
}))
vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    providers: async () => [],
    sessions: async () => ({ sessions: [] }),
    search: async () => [],
  },
}))
vi.mock('../sessions/managedStore', () => ({
  managedAgentStore: {
    captureRead: () => ({ nodeId: null, check: () => {}, current: () => true }),
    sessions: () => data.sessions,
    upsertSessions: () => {},
    activate: () => () => {},
  },
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createFleetQuery: () => [() => ({ rows: [], unavailable: [] })],
}))

const { default: AgentCenter } = await import('./AgentCenter')

const registrations: { dispose(): void }[] = []
afterEach(() => {
  registrations.splice(0).forEach((handle) => handle.dispose())
  Object.assign(data, { projectId: undefined, tasks: [], workspaces: [], sessions: [] })
})

it('opens the center before any provider or session data is available', () => {
  const host = document.createElement('div')
  let dispose: (() => void) | undefined
  try {
    expect(() => {
      dispose = render(() => <AgentCenter />, host)
    }).not.toThrow()
    expect(host.textContent).toContain('Agent Center')
  } finally {
    dispose?.()
  }
})

it('asks about its rows and draws a mark after the marked session’s title', async () => {
  const asked: unknown[][] = []
  registrations.push(
    extensionPointRegistry.register({
      id: AGENT_SESSION_POINT,
      ownerId: 'agents',
      label: 'Agent session',
      kind: 'annotation',
      key: [...AGENT_SESSION_KEY],
      max: 2,
      acceptedMarks: 256,
      acceptsDetail: true,
    }),
    extensionRegistry.register({
      id: 'session-health',
      pluginId: 'health',
      point: AGENT_SESSION_POINT,
      label: 'Session health',
      order: 10,
      carrier: 'items',
      marks: async (keys: unknown[]) => {
        asked.push(keys)
        return [{ key: { session: 's1' }, severity: 'danger', text: 'Struggling' }]
      },
    } as unknown as ExtensionContribution),
  )
  const session = (id: string, title: string) =>
    ({
      id,
      taskId: 't1',
      title,
      providerId: 'codex',
      kind: 'interactive',
      runtimeState: 'ready',
      attention: 'none',
      archivedAt: null,
      updatedAt: 1,
      config: {},
    }) as unknown as AgentSession
  Object.assign(data, {
    projectId: 'p1',
    workspaces: [{ id: 'w1', projects: [{ id: 'p1' }] }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'A task' }],
    sessions: [session('s2', 'Plain'), session('s1', 'Marked')],
  })
  const host = document.createElement('div')
  const dispose = render(() => <AgentCenter />, host)
  try {
    await vi.waitFor(() => expect(host.querySelector('.annotation-inline')).not.toBeNull())
    expect(asked).toEqual([[{ session: 's1' }, { session: 's2' }]])
    const row = host.querySelector('.annotation-inline')!.closest('.ui-row')!
    expect(row.textContent).toContain('Marked')
    expect(host.querySelector('.annotation-inline')!.textContent).toBe('Struggling')
    expect(host.querySelectorAll('.annotation-inline')).toHaveLength(1)
  } finally {
    dispose()
  }
})
