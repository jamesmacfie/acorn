import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { schema } from '../server/db/index'
import { makeTestDb, type TestDb } from '../testkit/db'
import { setRunBridge, type RunBridge } from '../server/routes/harness'
import { declaredTunnelPorts } from './tunnelPorts'

// The tunnel's allowlist IS the confinement ("Only declared ports; no general SOCKS" — docs/api-reference.md
// § Streams), and `tunnel.test.ts` stubs it. So the resolver gets its own suite against a real database:
// everything below is a decision about which ports on the node's loopback a client may reach.

let db: TestDb
const OWNER = 'acorn'
const REPO = 'widget'

const seedTask = async (): Promise<string> => {
  const now = Date.now()
  await db.db.insert(schema.workspaces).values({ id: 'workspace-widget', name: 'Widget', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await db.db.insert(schema.projects).values({
    id: 'project-widget', name: 'widget', path: '/tmp/widget', workspaceId: 'workspace-widget', sort: 0, hidden: false,
    vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: OWNER, githubName: REPO, githubRepoId: null,
    createdAt: now, updatedAt: now,
  })
  const id = randomUUID()
  await db.db.insert(schema.tasks).values({
    id, title: 'T', projectId: 'project-widget', branch: 'main', origin: 'local', status: 'active', sort: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  return id
}

const setRepoConfig = async (patch: { previewMode?: string; previewValue?: string }): Promise<void> => {
  await db.db.update(schema.projects).set(patch).where(eq(schema.projects.id, 'project-widget'))
}

const bridge = (targets: unknown, defaultUrl?: string): RunBridge => ({
  targets: async () => targets,
  start: async () => ({}),
  stop: async () => ({}),
  restart: async () => ({}),
  status: async () => ({}),
  defaultUrl: async () => defaultUrl,
})

beforeEach(() => {
  db = makeTestDb()
})
afterEach(() => {
  setRunBridge(null)
  db.cleanup()
})

describe('declaredTunnelPorts', () => {
  it('declares nothing for a task it cannot find', async () => {
    // Fails CLOSED. The upgrade handler treats an empty list as "nothing is tunnellable", so an unknown
    // taskId cannot borrow another task's ports.
    expect(await declaredTunnelPorts(db.db)(randomUUID())).toEqual([])
  })

  it('declares a previewMode:port value', async () => {
    const taskId = await seedTask()
    await setRepoConfig({ previewMode: 'port', previewValue: '5173' })
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([5173])
  })

  it('declares a previewMode:url loopback value', async () => {
    // This was MISSING, and its absence was the worse half of the bug: the client resolved the URL, asked
    // for a tunnel, got a 403, and fell back to loading the URL as given — so a remote task configured
    // `http://localhost:8025` rendered whatever was on the OWNER'S 8025 while claiming to show the remote
    // preview. It is declarative config, exactly like `port`.
    const taskId = await seedTask()
    await setRepoConfig({ previewMode: 'url', previewValue: 'http://localhost:8025/inbox' })
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([8025])
  })

  it('declares NOTHING for a previewMode:url pointing at a real host', async () => {
    // Already reachable from the client, so there is nothing to tunnel — and opening a port to it would be
    // the general proxy docs/api-reference.md rules out.
    const taskId = await seedTask()
    await setRepoConfig({ previewMode: 'url', previewValue: 'https://staging.example.com:8443' })
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([])
  })

  it('declares nothing for previewMode:script, which is the one uncovered case', async () => {
    // Its value is a shell command whose stdout is the URL. Running it to answer an upgrade would make
    // executing repo config incidental, which the config-trust gate exists to prevent — so a task using a
    // URL script gets no tunnel unless the port also appears as a run target or as previewMode:port. The
    // client fails closed there (node/tunnelUrl.ts returns null), so the pane shows nothing rather than the
    // owner's own localhost.
    const taskId = await seedTask()
    await setRepoConfig({ previewMode: 'script', previewValue: 'echo http://localhost:9999' })
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([])
  })

  it('declares EVERY run target\'s fixed url, not just the default one\'s', async () => {
    // Every fixed run-target URL is eligible because a layout recipe's browser URL can point to any target.
    const taskId = await seedTask()
    setRunBridge(bridge({ targets: [
      { id: 'app', url: 'http://localhost:3000', default: true },
      { id: 'storybook', url: 'http://127.0.0.1:6006' },
      { id: 'worker' }, // no url at all
      { id: 'remote', url: 'https://preview.example.com' }, // not loopback
    ] }, 'http://localhost:3000'))
    expect([...(await declaredTunnelPorts(db.db)(taskId))].sort((a, b) => a - b)).toEqual([3000, 6006])
  })

  it('survives a run bridge that throws, and still reports the repo config', async () => {
    const taskId = await seedTask()
    await setRepoConfig({ previewMode: 'port', previewValue: '4321' })
    setRunBridge({
      ...bridge(null),
      targets: async () => { throw new Error('no engine') },
      defaultUrl: async () => { throw new Error('no engine') },
    })
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([4321])
  })

  it('ignores a run bridge answering the error shape rather than targets', async () => {
    const taskId = await seedTask()
    setRunBridge(bridge({ error: 'needs-trust' }))
    expect(await declaredTunnelPorts(db.db)(taskId)).toEqual([])
  })
})
