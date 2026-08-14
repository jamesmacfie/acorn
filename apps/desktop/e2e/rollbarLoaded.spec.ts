import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const KEY = 'b'.repeat(64)
const roots: string[] = []
const apps: ElectronApplication[] = []
const NODE_APP = resolve(import.meta.dirname, '../../node')

const NODE_BUNDLE = `
import plugin from './real-node.js'

const upstreamFetch = globalThis.fetch
const now = Math.floor(Date.now() / 1000)
const item = {
  id: 999, counter: 142, title: 'Checkout failed in production', level: 40,
  environment: 'production', status: 'active', total_occurrences: 12,
  first_occurrence_timestamp: now - 86400, last_occurrence_timestamp: now - 60,
  last_occurrence_id: 555, framework: 'hono', assigned_user_id: 7,
}
const occurrence = {
  id: 555, timestamp: now - 60,
  data: {
    body: { trace: { exception: { class: 'CheckoutError', message: 'payment gateway timed out' },
      frames: [{ filename: 'src/checkout.ts', lineno: 42, colno: 7, method: 'submitOrder', in_app: true,
        code: 'throw new CheckoutError()', context: { pre: ['await gateway.authorize(order)'], post: [] } }] } },
    uuid: 'uuid-1', request: { method: 'POST', url: '/checkout' }, context: 'purchase',
    environment: 'production', code_version: 'abc123', platform: 'node', language: 'javascript',
    framework: 'hono', server: { host: 'web-1', branch: 'main' },
    notifier: { name: 'rollbar.js', version: '3.0.0' },
  },
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname !== 'api.rollbar.com') return upstreamFetch(input, init)
  let result
  if (url.pathname === '/api/1/project') result = { id: 7, name: 'Production' }
  else if (url.pathname === '/api/1/items') result = { items: [item] }
  else if (url.pathname === '/api/1/item_by_counter/142') result = item
  else if (url.pathname === '/api/1/item/999') result = item
  else if (url.pathname === '/api/1/item/999/instances') result = { instances: [occurrence] }
  else if (url.pathname === '/api/1/instance/555') result = occurrence
  else return new Response('not found', { status: 404 })
  return Response.json({ err: 0, result })
}

export default plugin
`

type PageBridge = {
  nodeFetch(nodeId: string, request: Record<string, unknown>): Promise<{ status: number; body: Uint8Array }>
  fleetList(): Promise<{ nodes: { nodeId: string; local: boolean }[] }>
}
type BridgeWindow = Window & { acorn?: PageBridge }

async function nodeJson<T>(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return page.evaluate(async ({ path, method, body }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const node = (await bridge.fleetList()).nodes.find((candidate) => candidate.local)
    if (!node) throw new Error('The local node is missing.')
    const response = await bridge.nodeFetch(node.nodeId, {
      requestId: `rollbar-e2e-${Math.random().toString(36).slice(2)}`,
      path, method: method ?? 'GET',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(body)) } }),
    })
    const text = new TextDecoder().decode(response.body)
    if (response.status < 200 || response.status >= 300) throw new Error(`${path}: ${response.status} ${text}`)
    return (text ? JSON.parse(text) : undefined) as T
  }, { path, method: init.method, body: init.body })
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; root: string; repo: string }> {
  const root = mkdtempSync(join(tmpdir(), 'acorn-rollbar-loaded-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const repo = join(root, 'repo')
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'e2e@acorn.test'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Acorn E2E'])
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'init'])
  execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), 'rollbar'], {
    cwd: NODE_APP,
    env: { ...process.env, ACORN_DATA_DIR: dataDir },
  })
  const dist = join(dataDir, 'plugins', 'rollbar', 'dist')
  renameSync(join(dist, 'node.js'), join(dist, 'real-node.js'))
  writeFileSync(join(dist, 'node.js'), NODE_BUNDLE)
  // Drop the dev-build marker `build:plugin` just wrote. It tells boot reconciliation "this package is a
  // temporary override, replace it with the bundled copy" (node-core/main/bundledPlugins.ts), which is
  // right for a developer and fatal here: the replacement would take the stubbed node bundle above with
  // it and this spec would drive the real api.rollbar.com. Without the marker the package reads as
  // owner-installed and is preserved, which is exactly what a fixture wants.
  rmSync(join(dataDir, 'plugins', 'rollbar', '.acorn-dev-build'), { force: true })

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${join(dataDir, 'chromium')}`],
    env: {
      ...process.env,
      ACORN_E2E: '1', ACORN_E2E_DATA_DIR: dataDir, SESSION_ENC_KEY: KEY,
      GITHUB_CLIENT_ID: 'e2e-client', GITHUB_CLIENT_SECRET: 'e2e-secret',
    },
  })
  apps.push(app)
  app.process().stdout?.on('data', (chunk: Buffer) => console.error(`[main:out] ${chunk.toString().trimEnd()}`))
  app.process().stderr?.on('data', (chunk: Buffer) => console.error(`[main:err] ${chunk.toString().trimEnd()}`))
  app.process().on('exit', (code, signal) => console.error(`[main:exit] code=${String(code)} signal=${String(signal)}`))
  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
  await expect(page.locator('.shell')).toBeVisible()
  return { app, page, root, repo }
}

const dismissOnboarding = async (page: Page): Promise<void> => {
  // These fixtures are first-run nodes — zero projects — so the wizard legitimately opens over them.
  // It is not what any of this suite tests, and once a security prompt stacks on top of it a click on
  // its own button can no longer land. So record the preference on the node, which survives the
  // reloads these specs do, and close the wizard directly if it has already painted.
  await page.evaluate(async () => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) return
    const fleet = await bridge.fleetList()
    const node = fleet.nodes.find((candidate) => candidate.local) ?? fleet.nodes[0]
    if (!node) return
    await bridge.nodeFetch(node.nodeId, {
      requestId: `e2e-onboarded-${Math.random().toString(36).slice(2)}`,
      path: '/v2/core/prefs',
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify({ key: 'onboarded', value: '1' })) },
    })
  })
  // Best-effort: a plugin-trust prompt is modal and paints above the wizard, so until the spec answers
  // it this click cannot land. The preference above is what actually settles it — this is only here to
  // close a wizard that is already reachable.
  const skip = page.getByRole('button', { name: 'skip for now' })
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 5_000 }).catch(() => {})
}

// Drop the persisted query cache (IndexedDB, via idb-keyval's default store) so the next load reads the
// node instead of the empty task list this document snapshotted at first paint. The snapshot is persisted
// across reloads and its staleTime outlives the spec, so a task seeded afterwards can stay invisible.
const clearPersistedQueries = async (page: Page): Promise<void> => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('keyval-store')
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  }))
}

const settle = async (page: Page): Promise<void> => {
  await expect.poll(async () => {
    await dismissOnboarding(page)
    return page.locator('.overlay-backdrop').count()
  }, { timeout: 30_000 }).toBe(0)
}

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('the loaded Rollbar package renders native rows and its real sandbox frame', async () => {
  test.setTimeout(180_000)
  const testInfo = test.info()
  const { page, repo } = await launch()
  await dismissOnboarding(page)

  // No trust prompt at all: rollbar is on the bundled first-party roster, and a development build
  // acknowledges that roster exactly as a packaged build does (main/bundledPluginTrust.ts). This used to
  // be a sixty-second loop that answered one dialog per bundled client bundle to reach rollbar's, because
  // the first prompt queued was not necessarily this spec's. What the dialog SAYS is asserted where it is
  // still raised — twoNode.spec.ts for a package a node serves, pluginInstall.spec.ts for an install.
  //
  // One unstated dependency, worth knowing before blaming a diff: the auto-grant is keyed by
  // (pluginId, hash) over the bytes read from `out/bundled-plugins`, and the fixture above installs its
  // own build into the DATA ROOT. Zero dialogs therefore also requires the two builds of rollbar's client
  // bundle to be byte-identical. They are, because the builder is deterministic over identical sources —
  // but anything that puts a timestamp, a build id or an absolute path into that bundle turns this
  // assertion into a surprise prompt, and the fix would be to build with `--package-root` into the
  // staging directory instead.
  await expect(page.locator('.plugin-trust-dialog')).toHaveCount(0)

  const workspace = await nodeJson<{ id: string }>(page, '/v2/core/workspaces', { method: 'POST', body: { name: 'Rollbar' } })
  const project = await nodeJson<{ project: { id: string } }>(page, '/v2/core/projects', {
    method: 'POST', body: { path: repo, workspaceId: workspace.id },
  })
  const connection = await nodeJson<{ integration: { id: string } }>(page, '/v2/core/integrations', {
    method: 'POST', body: { providerId: 'rollbar', credentials: { token: 'test-token' } },
  })
  const task = await nodeJson<{ id: string }>(page, '/v2/core/tasks', {
    method: 'POST', body: {
      origin: 'rollbar', projectId: project.project.id, branch: 'fix-checkout', title: 'Checkout failed',
      links: [{ connectionId: connection.integration.id, identifier: '142', ref: { displayId: '142', externalId: '999' } }],
    },
  })

  await clearPersistedQueries(page)
  await page.goto(new URL(`/t/${task.id}`, page.url()).toString())
  await page.reload()
  await settle(page)
  await page.getByRole('button', { name: 'Checkout failed', exact: true }).click()
  await page.locator('.pane-switch-btn[aria-label="Rollbar"]').click()

  const slot = page.locator('[data-pane-id="rollbar"]')
  await expect(slot).toBeVisible({ timeout: 30_000 })
  const iframe = slot.locator('iframe')
  await expect(iframe).toHaveAttribute('src', /^app-plugin:\/\/[0-9a-f]{64}\/index\.html$/)
  const frame = iframe.contentFrame()
  await expect(frame.locator('h1')).toHaveText('Checkout failed in production', { timeout: 30_000 })
  await expect(frame.locator('.rb-chips > .ui-badge')).toHaveText(['error', 'production', 'active'])
  await frame.getByRole('tab', { name: /^Occurrences/ }).click()
  await frame.getByRole('button', { name: /CheckoutError/ }).click()
  await expect(frame.locator('.rb-stack-location')).toContainText('src/checkout.ts:42')
  await page.screenshot({ path: testInfo.outputPath('rollbar-loaded.png') })
})
