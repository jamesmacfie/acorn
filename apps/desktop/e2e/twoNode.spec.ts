import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeProbeResult, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import type { PairingWindow } from '@acorn/protocol/node.ts'
import type { Workspace } from '@acorn/protocol/api.ts'

// plan.md's Phase 1 exit criterion: "one client process drives the bundled node AND a second node on
// another machine concurrently". This is that, with the second machine simulated by a second data root
// and a second ephemeral port — which is the whole reason the port stopped being pinned.
//
// Playwright rather than vitest, deliberately. The second node is the BUILT standalone artifact, and
// turbo's `test` task has no `build` dependency, so a vitest version would either be flaky or
// permanently skipped depending on what happened to be in apps/node/dist. `test:e2e` builds first
// (apps/desktop/package.json), so the artifact under test is always the current source.
//
// It also has to be Electron's Node rather than the runner's: `test:e2e` rebuilds better-sqlite3 for
// the Electron ABI, so a plain `node standalone.js` could not open a database at all. ELECTRON_RUN_AS_NODE
// is exactly how main/bootstrap.ts starts the bundled service and how agents launch the MCP entry.

const HERE = dirname(fileURLToPath(import.meta.url))
const STANDALONE_ENTRY = resolve(HERE, '../out/main/standalone.js')
// `electron`'s package main exports the binary path as a string; its types describe the renderer API
// instead, hence the cast.
const ELECTRON_BINARY = createRequire(import.meta.url)('electron') as unknown as string
const KEY = 'e'.repeat(64)
const NODE_BOOT_TIMEOUT_MS = 60_000

// The handshake line standalone.ts prints once it is listening. Everything a client needs to reach a
// node it did not spawn: where it bound, who it is, and the bearer to use.
type StandaloneHandshake = {
  nodeId: string
  endpoint: string
  fingerprint: string
  certPem: string
  deviceToken: string
}

const roots: string[] = []
const apps: ElectronApplication[] = []
const children: ChildProcess[] = []

type PageBridge = {
  nodeFetch(nodeId: string, request: Record<string, unknown>): Promise<{ status: number; body: Uint8Array }>
  fleetList(): Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }>
  nodeProbe(endpoint: string): Promise<NodeProbeResult>
  nodePair(request: { code: string; deviceName: string; label: string }): Promise<NodeRecord>
}
type BridgeWindow = Window & { acorn?: PageBridge }

// A request to a NAMED node through the broker. The smoke suite's helper always picks the local node;
// the whole point here is to address each node explicitly, which is also how Phase 4's fan-out will
// work (client-core/node/fleet.ts).
async function nodeJson<T>(page: Page, nodeId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return page.evaluate(async ({ nodeId, path, method, body }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const res = await bridge.nodeFetch(nodeId, {
      requestId: `e2e-${Math.random().toString(36).slice(2)}`,
      path,
      method: method ?? 'GET',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(body)) } }),
    })
    const text = new TextDecoder().decode(res.body)
    if (res.status < 200 || res.status >= 300) throw new Error(`${path}: ${res.status} ${text}`)
    return (text ? JSON.parse(text) : undefined) as T
  }, { nodeId, path, method: init.method, body: init.body })
}

// A request straight to the second node from the test process, pinned to the certificate it printed.
// This is the "other machine" side of the fixture: seeding it must NOT go through the client, or the
// test would be asserting that the client agrees with itself.
function remoteJson<T>(node: StandaloneHandshake, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body)
  const url = new URL(path, node.endpoint)
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init.method ?? 'GET',
        ca: [node.certPem],
        rejectUnauthorized: true,
        agent: false,
        headers: {
          authorization: `Bearer ${node.deviceToken}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`${path}: ${res.statusCode} ${text}`))
            return
          }
          resolvePromise((text ? JSON.parse(text) : undefined) as T)
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

// Boot the second node and read its handshake off stdout. Resolves only once the line has arrived, so
// nothing downstream has to guess whether it is listening.
function startSecondNode(dataDir: string): Promise<StandaloneHandshake> {
  const child = spawn(ELECTRON_BINARY, [STANDALONE_ENTRY], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ACORN_DATA_DIR: dataDir,
      SESSION_ENC_KEY: KEY,
      GITHUB_CLIENT_ID: 'e2e-client',
      // An ACORN_PORT inherited from the runner would pin the port, and two nodes on one machine is
      // precisely what this test is for.
      ACORN_PORT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  child.stderr?.on('data', (chunk: Buffer) => console.error(`[node-b] ${chunk.toString().trimEnd()}`))

  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('The second node never printed its handshake line.')), NODE_BOOT_TIMEOUT_MS)
    let pending = ''
    const settle = (outcome: () => void) => {
      clearTimeout(timer)
      outcome()
    }
    child.on('error', (error) => settle(() => reject(error)))
    child.on('exit', (code) => settle(() => reject(new Error(`The second node exited with code ${code} before handshaking.`))))
    child.stdout?.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        // Every other line this process logs is free-form, so the parse is the filter rather than a
        // prefix match on log text.
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        const candidate = parsed as Partial<StandaloneHandshake>
        if (candidate?.nodeId && candidate.endpoint && candidate.certPem && candidate.deviceToken && candidate.fingerprint) {
          settle(() => resolvePromise(candidate as StandaloneHandshake))
          return
        }
      }
    })
  })
}

type RunningApp = { app: ElectronApplication; page: Page; dataDir: string; repoDir: string }

async function launch(): Promise<RunningApp> {
  const root = mkdtempSync(join(tmpdir(), 'acorn-two-node-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const repoDir = join(root, 'repo')
  execFileSync('git', ['init', '-q', repoDir])
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'e2e@acorn.test'])
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Acorn E2E'])
  execFileSync('git', ['-C', repoDir, 'remote', 'add', 'origin', 'https://github.com/acorn/smoke.git'])
  execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-qm', 'init'])

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${join(dataDir, 'chromium')}`],
    env: {
      ...process.env,
      ACORN_E2E: '1',
      ACORN_E2E_DATA_DIR: dataDir,
      SESSION_ENC_KEY: KEY,
      GITHUB_CLIENT_ID: 'e2e-client',
      GITHUB_CLIENT_SECRET: 'e2e-secret',
    },
  })
  apps.push(app)
  const page = await app.firstWindow()
  await expect(page.locator('.shell')).toBeVisible()
  return { app, page, dataDir, repoDir }
}

// The same workspace / repo / task shape on both nodes, so the ONLY difference between what the two
// answer is the title — which is what makes the cache assertion below meaningful.
type Seed = { workspaceId: string; taskId: string }

async function seedLocal(page: Page, nodeId: string, repoDir: string, title: string): Promise<Seed> {
  const workspace = await nodeJson<{ id: string }>(page, nodeId, '/v2/core/workspaces', { method: 'POST', body: { name: 'Alpha' } })
  await nodeJson(page, nodeId, `/v2/core/workspaces/${workspace.id}/repos`, { method: 'POST', body: { owner: 'acorn', name: 'smoke' } })
  await nodeJson(page, nodeId, '/v2/p/terminal/terminal/repo-path', { method: 'PUT', body: { owner: 'acorn', repo: 'smoke', path: repoDir } })
  const task = await nodeJson<{ id: string }>(page, nodeId, '/v2/core/tasks', {
    method: 'POST',
    body: { origin: 'local', repoOwner: 'acorn', repoName: 'smoke', branch: 'main', title },
  })
  return { workspaceId: workspace.id, taskId: task.id }
}

// No repo-path mapping here, unlike the local node. The standalone entry wires only the pure-Node
// domain bridges, so `/v2/p/terminal/*` answers a clean 503 bridge-unavailable — the same degraded mode
// `dev:node` has always had (docs/electron.md § Capability map). Nothing this test asserts needs it: the
// rail scopes tasks by workspace_repos, and a checkout only matters once a remote task wants a worktree
// or a terminal, which is Phase 4's "a remote task's terminal/agent/preview work end-to-end".
async function seedRemote(node: StandaloneHandshake, title: string): Promise<Seed> {
  const workspace = await remoteJson<{ id: string }>(node, '/v2/core/workspaces', { method: 'POST', body: { name: 'Beta' } })
  await remoteJson(node, `/v2/core/workspaces/${workspace.id}/repos`, { method: 'POST', body: { owner: 'acorn', name: 'smoke' } })
  const task = await remoteJson<{ id: string }>(node, '/v2/core/tasks', {
    method: 'POST',
    body: { origin: 'local', repoOwner: 'acorn', repoName: 'smoke', branch: 'main', title },
  })
  return { workspaceId: workspace.id, taskId: task.id }
}

// Force the second node's workspace and task onto the FIRST node's UUIDs.
//
// architecture.md § Fleet semantics: "Two nodes may coincidentally hold the same UUID; that must never
// collide in the client." Coincidence cannot be arranged through the API — both routes mint their ids
// with randomUUID() server-side, which is correct — so the collision is manufactured on disk, the same
// way the smoke suite seeds agent rows with sqlite3. The database is WAL, so an external writer is fine
// while the node is running; busy_timeout covers the moment a request holds the write lock.
function collideIds(dataDir: string, from: Seed, to: Seed): void {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  execFileSync('sqlite3', [join(dataDir, 'core.sqlite'), `
    PRAGMA busy_timeout = 5000;
    BEGIN IMMEDIATE;
    UPDATE workspace_repos SET workspace_id = ${quote(to.workspaceId)} WHERE workspace_id = ${quote(from.workspaceId)};
    UPDATE workspaces SET id = ${quote(to.workspaceId)} WHERE id = ${quote(from.workspaceId)};
    UPDATE tasks SET id = ${quote(to.taskId)} WHERE id = ${quote(from.taskId)};
    COMMIT;
  `])
}

async function dismissOnboarding(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) await done.click()
}

// Land on the workspace route with both queries starting from the node rather than from whatever the
// pre-seed render cached. Same recipe as the smoke suite's openSmokeWorkspace.
async function openWorkspace(page: Page): Promise<void> {
  await page.goto(new URL('/acorn/smoke', page.url()).toString())
  await page.reload()
  await expect(page.locator('.shell')).toBeVisible()
  await dismissOnboarding(page)
}

const fleet = (page: Page) => page.evaluate(async () => {
  const bridge = (window as BridgeWindow).acorn
  if (!bridge) throw new Error('The node broker bridge is missing.')
  return bridge.fleetList()
})

test.afterEach(async () => {
  // The second node first: it holds its data root's lock, and the roots are removed below.
  for (const child of children.splice(0)) {
    child.kill('SIGTERM')
    // A node that ignores SIGTERM would otherwise keep a temp root alive for the rest of the run.
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
  }
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('drives the bundled node and a second node concurrently, with per-node caches', async () => {
  // Two node boots (the bundled one through Electron supervision, the second through the standalone
  // entry) plus a pairing round trip. S7 already sets 150s for a single-node scenario.
  test.setTimeout(120_000)

  const running = await launch()
  const localNodeId = (await fleet(running.page)).nodes.find((node) => node.local)?.nodeId
  if (!localNodeId) throw new Error('main never adopted the local node.')

  const remoteRoot = mkdtempSync(join(tmpdir(), 'acorn-node-b-'))
  roots.push(remoteRoot)
  const remote = await startSecondNode(join(remoteRoot, 'data'))
  expect(remote.nodeId).not.toBe(localNodeId)

  const local = await seedLocal(running.page, localNodeId, running.repoDir, 'Task on A')
  const seeded = await seedRemote(remote, 'Task on B')
  collideIds(join(remoteRoot, 'data'), seeded, local)

  // Pairing, through the bridge: the renderer holds no token and no certificate, so probe and pair are
  // both main's to perform (docs/vNext/architecture.md § How the client talks to nodes). The
  // fingerprint assertion stands in for the human comparing it against what the node displays — the
  // step that IS the security of pairing.
  const { code } = await remoteJson<PairingWindow>(remote, '/v2/core/pair/start', { method: 'POST' })
  const paired = await running.page.evaluate(async ({ endpoint, code }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const probe = await bridge.nodeProbe(endpoint)
    const node = await bridge.nodePair({ code, deviceName: 'Two-node e2e client', label: 'Second node' })
    return { probe, node }
  }, { endpoint: remote.endpoint, code })

  expect(paired.probe.fingerprint).toBe(remote.fingerprint)
  expect(paired.probe.compatible).toBe(true)
  expect(paired.node.nodeId).toBe(remote.nodeId)
  expect(paired.node.local).toBe(false)

  // Membership lives in main's fleet.json, and the renderer's copy is a projection refreshed at boot —
  // so a reload is also the proof that the pairing survived being written down.
  await running.page.reload()
  await expect(running.page.locator('.shell')).toBeVisible()
  await dismissOnboarding(running.page)

  // Both connections up AT THE SAME TIME, which is the exit criterion. `online` is only reported once
  // the authenticated WebSocket has opened (main/nodeBroker.ts), so this covers TLS pinning, the device
  // bearer and the upgrade for both nodes at once.
  await expect.poll(async () => {
    const { statuses } = await fleet(running.page)
    return [localNodeId, remote.nodeId].map((nodeId) => statuses.find((status) => status.nodeId === nodeId)?.state)
  }, { timeout: 30_000 }).toEqual(['online', 'online'])

  // The manufactured collision, as the two nodes see it: same workspace UUID, different name.
  const workspacesOf = (nodeId: string) => nodeJson<Workspace[]>(running.page, nodeId, '/v2/core/workspaces')
  expect((await workspacesOf(localNodeId)).map((workspace) => [workspace.id, workspace.name])).toEqual([[local.workspaceId, 'Alpha']])
  expect((await workspacesOf(remote.nodeId)).map((workspace) => [workspace.id, workspace.name])).toEqual([[local.workspaceId, 'Beta']])

  // ...and as the client renders it. One QueryClient per node means the rail's ['tasks'] entry for node
  // B cannot overwrite node A's even though both hold a task with this exact id.
  await openWorkspace(running.page)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toBeVisible()

  const switcher = running.page.locator('select.node-switcher')
  await expect(switcher.locator('option')).toHaveCount(2)

  await switcher.selectOption(remote.nodeId)
  await dismissOnboarding(running.page)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on B"]')).toBeVisible()
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toHaveCount(0)

  // Back again: node A's data is intact, not evicted by the visit to B.
  await switcher.selectOption(localNodeId)
  await dismissOnboarding(running.page)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toBeVisible()
  await expect(running.page.locator('.tabrail-task[aria-label="Task on B"]')).toHaveCount(0)

  await running.app.close()
})
