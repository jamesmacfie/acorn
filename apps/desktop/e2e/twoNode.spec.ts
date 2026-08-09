import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createHttpServer, request as httpGet } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeProbeResult, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import type { PairingWindow } from '@acorn/protocol/node.ts'
import { PLUGIN_API_MAJOR, type Workspace } from '@acorn/protocol/api.ts'

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
  // The stream and tunnel halves, used by the remote-task test. Declared here rather than cast at the call
  // site so a rename in the preload surfaces as a type error instead of a runtime undefined.
  nodeSend(nodeId: string, frame: unknown): void
  onNodeFrame(listener: (nodeId: string, frame: unknown) => void): () => void
  nodeTunnelOpen(request: { nodeId: string; taskId: string; port: number }): Promise<{ port: number }>
  // The preview surface, so the tunnel can be exercised the way the product does: through the pane's own
  // WebContentsView, whose session is what attaches the tunnel's secret.
  preview: { ensure(taskId: string, url: string): Promise<boolean> }
  // The third-party plugin cache and this device's trust decisions (main/pluginIpc.ts).
  plugins: {
    state(): Promise<{
      cached: Record<string, { pluginId: string; version: string; bytes: number }>
      acks: Array<{ pluginId: string; hash: string; nodeId: string; decision: string }>
    }>
  }
}
type BridgeWindow = Window & { acorn?: PageBridge }

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
    // Name the path: a bare 'socket hang up' from node:https says nothing about which request died, and
    // this helper makes half a dozen of them per test.
    req.on('error', (error: Error) => reject(new Error(`${path}: ${error.message}`)))
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

// Boot the second node and read its handshake off stdout. Resolves only once the line has arrived, so
// nothing downstream has to guess whether it is listening.
function startSecondNode(dataDir: string, options: { unsafePlugins?: boolean } = {}): Promise<StandaloneHandshake> {
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
      // The loader is inert without it (node-core/main/pluginLoader.ts), so a node with an installed
      // package still enumerates nothing unless this is set.
      ...(options.unsafePlugins ? { ACORN_UNSAFE_PLUGINS: '1' } : {}),
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
  // Electron main's logs, forwarded so a broker or tunnel failure names itself. Without this the preview
  // tunnel's first bug surfaced only as a bare `socket hang up` from the fetch on the other side of it.
  app.process().stderr?.on('data', (chunk: Buffer) => console.error(`[main] ${chunk.toString().trimEnd()}`))
  const page = await app.firstWindow()
  // An uncaught renderer error wedges Solid's flush queue, so the visible symptom is "the UI stopped
  // updating" with nothing else to go on. Forwarding these is how the fan-out key collision below was found.
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
  await expect(page.locator('.shell')).toBeVisible()
  return { app, page, dataDir, repoDir }
}

// The same workspace / repo / task shape on both nodes, so the ONLY difference between what the two
// answer is the title — which is what makes the cache assertion below meaningful.
type Seed = { workspaceId: string; projectId: string; taskId: string }

async function seedLocal(page: Page, nodeId: string, repoDir: string, title: string): Promise<Seed> {
  const workspace = await nodeJson<{ id: string }>(page, nodeId, '/v2/core/workspaces', { method: 'POST', body: { name: 'Alpha' } })
  const project = await nodeJson<{ project: { id: string } }>(page, nodeId, '/v2/core/projects', { method: 'POST', body: { path: repoDir, workspaceId: workspace.id } })
  const task = await nodeJson<{ id: string }>(page, nodeId, '/v2/core/tasks', {
    method: 'POST',
    body: { origin: 'local', projectId: project.project.id, branch: 'main', title },
  })
  return { workspaceId: workspace.id, projectId: project.project.id, taskId: task.id }
}

async function seedRemote(node: StandaloneHandshake, title: string, projectPath: string): Promise<Seed> {
  const workspace = await remoteJson<{ id: string }>(node, '/v2/core/workspaces', { method: 'POST', body: { name: 'Beta' } })
  const created = await remoteJson<{ project: { id: string } }>(node, '/v2/core/projects', {
    method: 'POST', body: { path: projectPath, workspaceId: workspace.id },
  })
  const task = await remoteJson<{ id: string }>(node, '/v2/core/tasks', {
    method: 'POST',
    body: { origin: 'local', projectId: created.project.id, branch: 'main', title },
  })
  return { workspaceId: workspace.id, projectId: created.project.id, taskId: task.id }
}

// A git repo on "the other machine", for a remote task that needs a worktree.
function makeRepo(dir: string): string {
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'e2e@acorn.test'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Acorn E2E'])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/acorn/smoke.git'])
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-qm', 'init'])
  return dir
}

// A fixture that boots the app and a second node and pairs them — the setup four of the five scenarios
// below share. Returns everything each needs to address either node explicitly.
type TwoNodes = {
  running: RunningApp
  localNodeId: string
  remote: StandaloneHandshake
  remoteRoot: string
  child: ChildProcess
}

async function pairTwoNodes(options: { unsafePlugins?: boolean; seedNode?: (dataDir: string) => void } = {}): Promise<TwoNodes> {
  const running = await launch()
  const localNodeId = (await fleet(running.page)).nodes.find((node) => node.local)?.nodeId
  if (!localNodeId) throw new Error('main never adopted the local node.')
  const remoteRoot = mkdtempSync(join(tmpdir(), 'acorn-node-b-'))
  roots.push(remoteRoot)
  // Before the node boots: the loader reads the plugins directory once, at start-up.
  options.seedNode?.(join(remoteRoot, 'data'))
  const remote = await startSecondNode(join(remoteRoot, 'data'), { ...(options.unsafePlugins ? { unsafePlugins: true } : {}) })
  const child = children[children.length - 1]!

  const { code } = await remoteJson<PairingWindow>(remote, '/v2/core/pair/start', { method: 'POST' })
  await running.page.evaluate(async ({ endpoint, code }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    await bridge.nodeProbe(endpoint)
    await bridge.nodePair({ code, deviceName: 'Two-node e2e client', label: 'Second node' })
  }, { endpoint: remote.endpoint, code })

  await running.page.reload()
  await expect(running.page.locator('.shell')).toBeVisible()
  await dismissOnboarding(running.page)
  await expect.poll(async () => {
    const { statuses } = await fleet(running.page)
    return [localNodeId, remote.nodeId].map((nodeId) => statuses.find((status) => status.nodeId === nodeId)?.state)
  }, { timeout: 30_000 }).toEqual(['online', 'online'])

  return { running, localNodeId, remote, remoteRoot, child }
}

const stateOf = async (page: Page, nodeId: string): Promise<NodeStatus['state'] | undefined> =>
  (await fleet(page)).statuses.find((status) => status.nodeId === nodeId)?.state

// Force the second node's workspace and task onto the FIRST node's UUIDs.
//
// docs/architecture-overview.md § Fleet semantics: "Two nodes may coincidentally hold the same UUID; that must never
// collide in the client." Coincidence cannot be arranged through the API — both routes mint their ids
// with randomUUID() server-side, which is correct — so the collision is manufactured on disk, the same
// way the smoke suite seeds agent rows with sqlite3. The database is WAL, so an external writer is fine
// while the node is running; busy_timeout covers the moment a request holds the write lock.
function collideIds(dataDir: string, from: Seed, to: Seed): void {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  execFileSync('sqlite3', [join(dataDir, 'core.sqlite'), `
    PRAGMA busy_timeout = 5000;
    BEGIN IMMEDIATE;
    UPDATE projects SET workspace_id = ${quote(to.workspaceId)} WHERE workspace_id = ${quote(from.workspaceId)};
    UPDATE workspaces SET id = ${quote(to.workspaceId)} WHERE id = ${quote(from.workspaceId)};
    UPDATE tasks SET id = ${quote(to.taskId)} WHERE id = ${quote(from.taskId)};
    COMMIT;
  `])
}

async function dismissOnboarding(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) await done.click()
}

// Land on the project route with both queries starting from the node rather than from whatever the
// pre-seed render cached. Same recipe as the smoke suite's openSmokeWorkspace.
async function openWorkspace(page: Page, projectId: string): Promise<void> {
  await page.goto(new URL(`/p/${projectId}`, page.url()).toString())
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
  const seeded = await seedRemote(remote, 'Task on B', makeRepo(join(remoteRoot, 'repo')))
  collideIds(join(remoteRoot, 'data'), seeded, local)

  // Pairing, through the bridge: the renderer holds no token and no certificate, so probe and pair are
  // both main's to perform (docs/architecture-overview.md § How the client talks to nodes). The
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
  await openWorkspace(running.page, local.projectId)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toBeVisible()

  const switcher = running.page.locator('select.node-switcher')
  await expect(switcher.locator('option')).toHaveCount(2)

  // No navigation around the switch: the active node is an in-memory signal (node/activeNode.ts), and
  // selectActiveNode re-homes the window onto the local node on every reload. Switching nodes has to
  // repopulate the rail in place, which is the per-node cache claim this test is here to make.
  await switcher.selectOption(remote.nodeId)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on B"]')).toBeVisible()
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toHaveCount(0)

  // Back again: node A's data is intact, not evicted by the visit to B.
  await switcher.selectOption(localNodeId)
  await expect(running.page.locator('.tabrail-task[aria-label="Task on A"]')).toBeVisible()
  await expect(running.page.locator('.tabrail-task[aria-label="Task on B"]')).toHaveCount(0)

  await running.app.close()
})

test('hides the fleet surfaces with one node and shows them with two', async () => {
  test.setTimeout(120_000)

  const running = await launch()
  await dismissOnboarding(running.page)
  // docs/ui-design.md § New surfaces: "With only the bundled local node, this view stays out of the way; first-run
  // never mentions nodes at all."
  await expect(running.page.locator('.tabrail-source[aria-label="Fleet"]')).toHaveCount(0)
  await expect(running.page.locator('.node-switcher')).toHaveCount(0)

  // Pair a second node into the SAME running app, rather than launching a fresh two-node one: what is
  // under test is that these surfaces appear when the fleet grows, which a second launch would hide
  // behind a fresh render.
  const remoteRoot = mkdtempSync(join(tmpdir(), 'acorn-node-b-'))
  roots.push(remoteRoot)
  const remote = await startSecondNode(join(remoteRoot, 'data'))
  // Named `pairing`, not `window`: a local called `window` shadows the browser global inside the
  // `page.evaluate` callback below, which type-checks against the wrong thing entirely.
  const pairing = await remoteJson<PairingWindow>(remote, '/v2/core/pair/start', { method: 'POST' })
  await running.page.evaluate(
    async ({ code, endpoint }) => {
      const bridge = (window as BridgeWindow).acorn!
      await bridge.nodeProbe(endpoint)
      await bridge.nodePair({ code, deviceName: 'e2e client', label: 'Node B' })
    },
    { code: pairing.code, endpoint: remote.endpoint },
  )
  await running.page.reload()
  await running.page.waitForSelector('.shell')
  await dismissOnboarding(running.page)

  await expect(running.page.locator('.tabrail-source[aria-label="Fleet"]')).toBeVisible()
  await expect(running.page.locator('.node-switcher')).toBeVisible()
  // The picker lists both nodes by label — the switcher existing is not the same as it being useful.
  const labels = await running.page.locator('.node-switcher option').evaluateAll((options) => options.map((o) => o.textContent))
  expect(labels).toHaveLength(2)
  expect(labels).toContain('Node B')

  await running.app.close()
})

test('renders the fleet with one node down: a banner, and every other node still listed', async () => {
  test.setTimeout(120_000)
  const { running, localNodeId, remote, child } = await pairTwoNodes()

  // Fleet home only exists with more than one node paired (`SourceContribution.when`), so its presence in the
  // rail is itself part of the assertion — with a single node the button must not be there at all.
  await expect(running.page.locator('.tabrail-source[aria-label="Fleet"]')).toBeVisible()
  await running.page.locator('.tabrail-source[aria-label="Fleet"]').click()
  await expect(running.page.locator(`.fleet-card[data-node-id="${localNodeId}"]`)).toBeVisible()
  await expect(running.page.locator(`.fleet-card[data-node-id="${remote.nodeId}"]`)).toBeVisible()

  child.kill('SIGKILL')
  try {
    await expect.poll(() => stateOf(running.page, remote.nodeId), { timeout: 60_000 }).not.toBe('online')

    // The criterion: "aggregated surfaces with one node down". BOTH cards stay rendered — never a failed
    // page (docs/architecture-overview.md § Fleet semantics) — and the one that went away says so.
    //
    // It is NOT asserted that a `.fleet-banner` appears, and that is a correction to this test's first
    // version rather than a gap. `createFleetQuery` falls back to the dead node's OWN QueryClient, which is
    // warm from the successful render above, so the honest rendering here is a STALE ROW and the banner is
    // reserved for a node that has never answered. That fallback is the whole point of partitioning the cache
    // per node, so asserting the banner instead would have been asserting the weaker behaviour. The banner
    // path is covered directly, with an empty cache, in client-core's fanout.test.ts.
    await expect(running.page.locator(`.fleet-card[data-node-id="${remote.nodeId}"] .node-chip`))
      .toHaveAttribute('data-freshness', 'offline', { timeout: 30_000 })
    await expect(running.page.locator(`.fleet-card[data-node-id="${localNodeId}"] .node-chip`))
      .toHaveAttribute('data-freshness', 'live')
    await expect(running.page.locator(`.fleet-card[data-node-id="${localNodeId}"]`)).toBeVisible()
    await expect(running.page.locator(`.fleet-card[data-node-id="${remote.nodeId}"]`)).toBeVisible()
    // Served from cache, not blanked: the task count is still a number rather than the em dash the card shows
    // when a node has said nothing at all. docs/ui-design.md: "reads come from cache with badges."
    await expect(running.page.locator(`.fleet-card[data-node-id="${remote.nodeId}"] .fleet-card-stats dd`).first())
      .not.toHaveText('—')

    // The other half of this criterion — a mutation to an offline node failing fast with `node_offline` and
    // the user's text kept as a draft — is NOT asserted here, deliberately. It lives inside `apiClient.send`,
    // and reaching it from Playwright would mean either importing a renderer module by specifier (which the
    // bundle does not expose at runtime) or driving a whole compose form. It is covered directly, with
    // non-vacuity checks, in packages/client-core/src/apiClient.test.ts and by PullDetail's `runThenClear`.
  } finally {
    // afterEach kills it again, harmlessly.
  }
  await running.app.close()
})

test('reports a node as revoked when it revokes this client mid-session', async () => {
  test.setTimeout(120_000)
  const { running, remote } = await pairTwoNodes()

  // Revoked FROM the node, by the test process — not through the client, or this would be asserting that
  // the client agrees with itself. docs/api-reference.md § Pairing: "deleting a device row invalidates its token
  // immediately — open sockets are closed, in-flight requests fail."
  const devices = await remoteJson<{ devices: { id: string; name: string }[] }>(remote, '/v2/core/devices')
  const ours = devices.devices.find((device) => device.name === 'Two-node e2e client')
  if (!ours) throw new Error('The node does not list the device it just paired.')
  await remoteJson(remote, `/v2/core/devices/${ours.id}`, { method: 'DELETE' })

  // `revoked`, specifically — not `offline`. The broker distinguishes them (a 401 whose envelope says
  // `unauthenticated` stops the reconnect loop entirely), and the distinction is what stops the app
  // retrying forever against a node that has torn up its credential.
  await expect.poll(() => stateOf(running.page, remote.nodeId), { timeout: 60_000 }).toBe('revoked')
  // The local node is untouched, which is the fleet property under test: one node's credential failing is
  // not the fleet failing.
  expect(await stateOf(running.page, (await fleet(running.page)).nodes.find((node) => node.local)!.nodeId)).toBe('online')
  await running.app.close()
})

// A client-only plugin package: a manifest and one ESM file. Enough to be distributed, which is the
// whole of what phase 2 does — nothing renders it until phase 3. Written straight to disk rather than
// built, because what is under test is the transfer and the acknowledgement, not a bundler.
const PLUGIN_ID = 'e2e-widget'
const PLUGIN_BUNDLE = 'export default { name: "e2e-widget" }\n'

function installPluginOn(dataDir: string): void {
  const dir = join(dataDir, 'plugins', PLUGIN_ID)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'client.js'), PLUGIN_BUNDLE)
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: PLUGIN_ID,
    name: 'E2E widget',
    version: '1.4.0',
    apiVersion: PLUGIN_API_MAJOR,
    client: './dist/client.js',
    // `core.tasks:read` is the api vocabulary the UI bridge enforces (client-core/plugins/frames/scopes.ts);
    // phase 2 only displays it, but a fixture spelling it the old way would be a manifest no acorn accepts.
    permissions: { api: ['core.tasks:read'], node: { core: ['projects:read'] } },
  }))
}

const pluginState = (page: Page) => page.evaluate(() => (window as BridgeWindow).acorn!.plugins.state())

test('asks before running a plugin a paired node serves, then caches it for offline boots', async () => {
  test.setTimeout(150_000)
  // The exit criterion for docs/third-party/phase-2-distribution-trust.md: a plugin installed on a
  // paired node reaches a second device, is hash-verified there, and does not run until the owner
  // agrees. `pairTwoNodes` reloads after pairing, and the boot pass runs on that reload.
  const { running, remote } = await pairTwoNodes({ unsafePlugins: true, seedNode: installPluginOn })

  // The node advertises it, with its declared permissions riding in the roster row.
  const roster = await nodeJson<{ plugins: Array<{ name: string; installed?: { version: string; client: { hash: string } | null } }> }>(
    running.page, remote.nodeId, '/v2/core/plugins',
  )
  const row = roster.plugins.find((plugin) => plugin.name === PLUGIN_ID)
  expect(row?.installed?.version).toBe('1.4.0')
  expect(row?.installed?.client?.hash).toMatch(/^[0-9a-f]{64}$/)

  // The prompt names the plugin, its version, the NODE it came from, and what it declared. Naming the
  // node is the part that matters: the owner is being asked to run code one specific machine handed
  // this one.
  const dialog = running.page.locator('.plugin-trust-dialog')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toContainText(PLUGIN_ID)
  await expect(dialog).toContainText('1.4.0')
  await expect(dialog).toContainText('Second node')
  await expect(dialog).toContainText('node: core.projects:read')
  await expect(dialog).toContainText('api: core.tasks:read')

  await dialog.getByRole('button', { name: 'Trust this plugin' }).click()
  await expect(dialog).toHaveCount(0)

  // Main computed the hash from the bytes it received, and the acknowledgement is bound to THAT.
  const afterAccept = await pluginState(running.page)
  const hash = row!.installed!.client!.hash
  expect(Object.keys(afterAccept.cached)).toContain(hash)
  expect(afterAccept.cached[hash]).toMatchObject({ pluginId: PLUGIN_ID, version: '1.4.0' })
  expect(afterAccept.acks).toContainEqual(expect.objectContaining({ pluginId: PLUGIN_ID, hash, nodeId: remote.nodeId, decision: 'accepted' }))

  // Offline: the node is gone, the cache is not. The bundle and the decision both survive a boot with
  // nothing to connect to, which is what makes the cache worth having.
  for (const child of children.splice(0)) child.kill('SIGKILL')
  await running.page.reload()
  await expect(running.page.locator('.shell')).toBeVisible()
  await dismissOnboarding(running.page)
  const offline = await pluginState(running.page)
  expect(Object.keys(offline.cached)).toContain(hash)
  expect(offline.acks).toContainEqual(expect.objectContaining({ pluginId: PLUGIN_ID, decision: 'accepted' }))
  // And it does not ask a second time about bytes it has already been told about.
  await expect(running.page.locator('.plugin-trust-dialog')).toHaveCount(0)

  await running.app.close()
})

test('runs a terminal and opens a preview tunnel on a remote task, over the LAN', async () => {
  test.setTimeout(180_000)
  const { running, remote, remoteRoot } = await pairTwoNodes()

  // A checkout on the OTHER machine, which is what makes this a remote-task test rather than a local one
  // with an extra hop: the worktree, the PTY and the dev server all live beside the node.
  const seeded = await seedRemote(remote, 'Task on B', makeRepo(join(remoteRoot, 'repo')))

  const output = await running.page.evaluate(async ({ nodeId, taskId }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const created = await bridge.nodeFetch(nodeId, {
      requestId: `e2e-term-${Math.random().toString(36).slice(2)}`,
      path: '/v2/p/terminal/sessions',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify({ taskId, profileId: 'shell', command: "printf 'ACORN_REMOTE_ECHO\\n'", title: 'Remote terminal' })) },
    })
    const text = new TextDecoder().decode(created.body)
    if (created.status < 200 || created.status >= 300) throw new Error(`create session: ${created.status} ${text}`)
    const sessionId = (JSON.parse(text) as { id: string }).id
    return new Promise<string>((resolve, reject) => {
      let seen = ''
      const off = bridge.onNodeFrame((frameNodeId, raw) => {
        const frame = raw as { channel?: string; id?: string; msg?: { type: string; data?: string } }
        if (frameNodeId !== nodeId || frame.channel !== 'term:out' || frame.id !== sessionId || !frame.msg) return
        if (frame.msg.type === 'output') seen += frame.msg.data ?? ''
        if (frame.msg.type === 'exit') { window.clearTimeout(timer); off(); resolve(seen) }
      })
      const timer = window.setTimeout(() => { off(); reject(new Error(`remote terminal timeout: ${seen}`)) }, 30_000)
      bridge.nodeSend(nodeId, { channel: 'term:attach', id: sessionId })
    })
  }, { nodeId: remote.nodeId, taskId: seeded.taskId })
  expect(output).toContain('ACORN_REMOTE_ECHO')

  // The preview tunnel. A plain HTTP server stands in for a dev server on the node's host — in this fixture
  // that is the same machine, but nothing in the path knows it: the bytes still cross the pinned WebSocket
  // to `/v2/tunnel` and come back through a loopback listener main created.
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ACORN_TUNNEL_OK')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const devPort = (server.address() as { port: number }).port
  try {
    // Declared, which is what makes it tunnellable at all — "Only declared ports; no general SOCKS".
    // Project configuration is keyed by the project identity.
    await remoteJson(remote, `/v2/core/projects/${seeded.projectId}/config`, {
      method: 'PUT',
      body: { patch: { previewMode: 'port', previewValue: String(devPort) } },
    })

    // The renderer opens the tunnel and learns only a loopback port…
    const tunnelPort = await running.page.evaluate(async ({ nodeId, taskId, devPort }) => {
      const bridge = (window as BridgeWindow).acorn
      if (!bridge) throw new Error('The node broker bridge is missing.')
      return (await bridge.nodeTunnelOpen({ nodeId, taskId, port: devPort })).port
    }, { nodeId: remote.nodeId, taskId: seeded.taskId, devPort })
    // A LOCAL port, not the node's — the whole point. The renderer never learns the node's endpoint.
    expect(tunnelPort).not.toBe(devPort)

    await running.page.evaluate(
      ({ taskId, tunnelPort }) => (window as BridgeWindow).acorn!.preview.ensure(taskId, `http://127.0.0.1:${tunnelPort}/`),
      { taskId: seeded.taskId, tunnelPort },
    )
    // Read from MAIN, because a WebContentsView is not a Playwright page: it is a separate guest contents
    // with no window of its own, so `electronApp.evaluate` and `webContents.getAllWebContents()` are how a
    // test sees what it rendered.
    const rendered = await running.app.evaluate(async ({ webContents }, port) => {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const view = webContents.getAllWebContents().find((contents) => contents.getURL().includes(`127.0.0.1:${port}`))
        if (view && !view.isLoading()) {
          const text = (await view.executeJavaScript('document.body.innerText')) as string
          if (text.trim()) return text.trim()
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return '(the preview never rendered)'
    }, tunnelPort)
    expect(rendered).toBe('ACORN_TUNNEL_OK')

    const uncredentialed = await new Promise<{ ok: boolean; text: string }>((resolvePromise) => {
      const request = httpGet({ host: '127.0.0.1', port: tunnelPort, path: '/' }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolvePromise({ ok: true, text: Buffer.concat(chunks).toString('utf8') }))
      })
      request.on('error', (error) => resolvePromise({ ok: false, text: error.message }))
      request.end()
    })
    expect(uncredentialed.text).not.toContain('ACORN_TUNNEL_OK')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await running.app.close()
})
