import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'

// The exit criteria for docs/plugins.md, as assertions.
//
// The exit criteria for docs/plugins.md, as assertions.
//
// The plugin here has no client bundle at all, which is the whole point of the phase. Every pixel is
// drawn by the host from the manifest's descriptors, and every number in it comes from the plugin's
// node half over its own routes. There is no trust prompt to click past either: descriptors execute
// nothing, so there are no bytes for this device to acknowledge, and the rail icon has to be there
// without one.
//
// Local node rather than a paired one, for the same reason pluginFrame.spec.ts gives: distribution is
// phase 2's test, and pairing would add ninety seconds to every assertion here.

const KEY = 'c'.repeat(64)
const PLUGIN_ID = 'e2e-board'
const PROVIDER_ID = 'e2e-board-provider'
const SOURCE_LABEL = 'E2E board'

const roots: string[] = []
const apps: ElectronApplication[] = []

// The node half: four descriptor routes and a mutation. `ctx.routes.fetch` is the only door a loaded
// plugin gets (a Hono instance cannot cross a process boundary), and the path it sees is relative to
// its own `/v2/p/<id>` mount.
//
// `ctx.events.status()` after the mutation is the freshness path the phase doc specifies: the content-
// free ping on the existing invalidation channel, which makes the client re-read its chrome. No new
// event type, no payload to trust.
const NODE_BUNDLE = `
let stuck = 1
const provider = {
  id: ${JSON.stringify(PROVIDER_ID)},
  label: 'E2E board',
  glyph: 'kanban',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key', fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
    connectable: true, disconnectable: true,
    async validate(credentials) { return credentials.apiKey || '' },
    normalize(_credentials, secret) {
      return { secret, label: 'E2E board', account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() { return { ok: true } },
  },
  capabilities: {},
  budgets: {
    maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1, maxPages: 1,
    maxCachedItemBytes: 10000, maxContextItems: 10, backoffFloorMs: 1000, maxResolutionBatch: 10,
  },
  externalIds: {
    fromDisplay(connectionId, displayId) { return { providerId: ${JSON.stringify(PROVIDER_ID)}, connectionId, displayId } },
    parse(raw, fallback) {
      return raw && raw.providerId === ${JSON.stringify(PROVIDER_ID)} && typeof raw.connectionId === 'string' && typeof raw.displayId === 'string'
        ? raw : fallback
    },
  },
  resources: [],
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none', acceptedWrites: false },
  toPublic() {
    return {
      id: this.id, label: this.label, glyph: this.glyph, kind: this.kind,
      connection: {
        authKind: this.connection.authKind, fields: this.connection.fields,
        connectable: true, disconnectable: true,
      },
      capabilities: {},
    }
  },
}
export default {
  name: ${JSON.stringify(PLUGIN_ID)},
  init(ctx) {
    // Provider routes use the portable fetch carrier too; a loaded plugin never hands the host Hono.
    ctx.providers.integration(provider, () => Response.json({ ok: true }))
    ctx.routes.fetch(async (request, context) => {
      const path = new URL(request.url).pathname
      if (path === '/rail-items') {
        const [connection] = await context.providers.connections(${JSON.stringify(PROVIDER_ID)})
        return Response.json({ items: [
          // The badge carries the mutable count, so a node-side change is visible in the rail.
          {
            id: 'card-1', title: 'Ship the thing', subtitle: 'in progress', badge: String(stuck) + ' stuck',
            task: connection ? {
              branch: 'ship-the-thing',
              link: { connectionId: connection.id, identifier: 'card-1', ref: { displayId: 'card-1' } },
            } : undefined,
          },
          { id: 'card-2', title: 'Write it down' },
          // Dropped by the host's defensive filter, and the two above must still render.
          { title: 'no id at all' },
        ] })
      }
      if (path === '/badge') return Response.json({ text: String(stuck) + ' stuck', tone: 'warn' })
      if (path === '/attention') {
        return Response.json({ items: [{ id: 'card-1', title: 'Card 1 is stuck', severity: 'warn', at: 1 }] })
      }
      if (path === '/stat') return Response.json({ value: stuck })
      if (path === '/bump') {
        stuck += 1
        ctx.events.status()
        return Response.json({ ok: true })
      }
      return new Response('not found', { status: 404 })
    })
  },
}
`

function installPlugin(dataDir: string): void {
  const dir = join(dataDir, 'plugins', PLUGIN_ID)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'node.js'), NODE_BUNDLE)
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: PLUGIN_ID,
    name: 'E2E board',
    version: '1.0.0',
    apiVersion: PLUGIN_API_MAJOR,
    node: './dist/node.js',
    // No `client`. Nothing about this plugin runs in the renderer.
    contributions: {
      sources: [{
        id: 'e2e-board', label: SOURCE_LABEL, glyph: 'kanban', order: 5,
        items: `/v2/p/${PLUGIN_ID}/rail-items`, onSelect: { verb: 'createTask' },
      }],
      slots: [{ id: 'e2e-board-footer', slot: 'footer', data: `/v2/p/${PLUGIN_ID}/badge` }],
      commands: [{ id: 'bump', title: 'Board: bump the count', action: { verb: 'runNodeAction', path: `/v2/p/${PLUGIN_ID}/bump` } }],
      keybindings: [{ command: 'bump', defaultChord: 'meta+alt+u', when: 'global' }],
      attention: [{ id: 'e2e-board-stuck', items: `/v2/p/${PLUGIN_ID}/attention` }],
      nodeStats: [{ id: 'e2e-board-count', label: ['card stuck', 'cards stuck'], data: `/v2/p/${PLUGIN_ID}/stat` }],
    },
  }))
}

type PageBridge = {
  nodeFetch(nodeId: string, request: Record<string, unknown>): Promise<{ status: number; body: Uint8Array }>
  fleetList(): Promise<{ nodes: { nodeId: string; local: boolean }[] }>
}
type BridgeWindow = Window & { acorn?: PageBridge }

async function nodeJson<T>(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return page.evaluate(async ({ path, method, body }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const fleet = await bridge.fleetList()
    const node = fleet.nodes.find((candidate) => candidate.local) ?? fleet.nodes[0]
    if (!node) throw new Error('The fleet is empty — main never adopted the local node.')
    const res = await bridge.nodeFetch(node.nodeId, {
      requestId: `e2e-${Math.random().toString(36).slice(2)}`,
      path,
      method: method ?? 'GET',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(body)) } }),
    })
    const text = new TextDecoder().decode(res.body)
    if (res.status < 200 || res.status >= 300) throw new Error(`${path}: ${res.status} ${text}`)
    return (text ? JSON.parse(text) : undefined) as T
  }, { path, method: init.method, body: init.body })
}

type Running = { app: ElectronApplication; page: Page; dataDir: string; repoDir: string }

async function launch(): Promise<Running> {
  const root = mkdtempSync(join(tmpdir(), 'acorn-plugin-chrome-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const repoDir = join(root, 'repo')
  execFileSync('git', ['init', '-q', repoDir])
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'e2e@acorn.test'])
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Acorn E2E'])
  execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-qm', 'init'])
  installPlugin(dataDir)

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
  app.process().stderr?.on('data', (chunk: Buffer) => console.error(`[main] ${chunk.toString().trimEnd()}`))
  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
  await expect(page.locator('.shell')).toBeVisible()
  return { app, page, dataDir, repoDir }
}

const dismissOnboarding = async (page: Page): Promise<void> => {
  // These fixtures are first-run nodes with zero projects, so the wizard legitimately opens over them.
  // It is not what any of this suite tests, and once a security prompt stacks on top of it, a click on
  // its own button can no longer land. Recording the preference on the node settles it, since it
  // survives the reloads these specs do; closing the wizard directly here only helps when it has
  // already painted.
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
  // it, this click cannot land. The preference above is what actually settles it; this click only
  // closes a wizard that is already reachable.
  const skip = page.getByRole('button', { name: 'skip for now' })
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 5_000 }).catch(() => {})
}

const settleOverlays = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => {
      await dismissOnboarding(page)
      return page.locator('.overlay-backdrop').count()
    }, { timeout: 30_000 })
    .toBe(0)
}

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('a plugin with no client bundle contributes native chrome', async () => {
  test.setTimeout(120_000)
  const { page, repoDir } = await launch()
  // Straight after boot: these fixtures have zero projects, so the first-run wizard opens over them.
  await dismissOnboarding(page)
  await settleOverlays(page)

  // The descriptor promotion needs a real project and a real provider connection. The row obtains
  // the host-owned connection id through PluginProviderRuntime; no database handle crosses the seam.
  const workspace = await nodeJson<{ id: string }>(page, '/v2/core/workspaces', { method: 'POST', body: { name: 'Chrome' } })
  const project = await nodeJson<{ project: { id: string } }>(page, '/v2/core/projects', {
    method: 'POST', body: { path: repoDir, workspaceId: workspace.id },
  })
  await nodeJson(page, '/v2/core/integrations', {
    method: 'POST', body: { providerId: PROVIDER_ID, credentials: { apiKey: 'e2e-key' } },
  })
  await page.goto(new URL(`/p/${project.project.id}`, page.url()).toString())
  await settleOverlays(page)

  // No trust dialog: there are no bytes to acknowledge, so the chrome is simply there. Asserting its
  // absence is the phase-4 half of "trust binds to bytes": chrome is data, and data is not code.
  await expect(page.locator('.plugin-trust-dialog')).toHaveCount(0)

  // The host-adapted binding is an ordinary Settings row, grouped under the plugin and scoped to
  // this node's preference store.
  await page.keyboard.press('Meta+,')
  const settings = page.locator('.overlay.settings')
  await settings.locator('.settings-nav-item', { hasText: 'Shortcuts' }).click()
  await expect(settings.getByLabel('Shortcut for Board: bump the count')).toHaveValue('⌥⌘U')
  await expect(settings.locator('.shortcut-group-heading', { hasText: PLUGIN_ID })).toBeVisible()
  await settings.getByRole('button', { name: 'Close' }).click()

  // ── Rail source, rendered natively from the descriptor ─────────────────────────────────────────
  const railButton = page.getByRole('button', { name: SOURCE_LABEL })
  await expect(railButton).toBeVisible({ timeout: 60_000 })
  await railButton.click()

  // `.ui-row` is the shell's own primitive: a third-party rail list is the same markup a first-party
  // one is, which is the argument for descriptors over an iframe at this size.
  const rows = page.locator('.ui-row')
  await expect(rows).toHaveCount(2, { timeout: 30_000 })
  await expect(rows.first()).toContainText('Ship the thing')
  // The row with no id was dropped by the host's filter rather than thrown into the shell.
  await expect(page.locator('.ui-row', { hasText: 'no id at all' })).toHaveCount(0)

  // ── Freshness: the node mutates and pings, the client re-reads ─────────────────────────────────
  //
  // Asserted on the rail badge rather than on the task-footer one, which is otherwise the phase doc's
  // example. The footer only renders its slots for a task that has a worktree, and a worktree is
  // created lazily by whatever first needs a cwd, so the badge would be testing the shell's worktree
  // lifecycle, not this. Both surfaces read through the same query and the same revision signal
  // (client-core/plugins/chrome/data.ts), and the slot registration itself is unit-covered.
  const badge = rows.first().locator('.ui-badge')
  await expect(badge).toHaveText('1 stuck', { timeout: 30_000 })

  // Nothing pushed a value: `ctx.events.status()` is content-free, and the client re-pulls whatever it
  // is showing rather than trusting a payload.
  await nodeJson(page, `/v2/p/${PLUGIN_ID}/bump`, { method: 'POST' })
  await expect(badge).toHaveText('2 stuck', { timeout: 30_000 })

  // ── Palette row, from the same manifest, running a declared verb ───────────────────────────────
  await nodeJson(page, '/v2/core/tasks', {
    method: 'POST', body: { origin: 'local', projectId: project.project.id, branch: 'main', title: 'Chrome task' },
  })

  await page.keyboard.press('Meta+k')
  const row = page.locator('.palette-row', { hasText: 'Board: bump the count' })
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await row.click()
  // `runNodeAction` POSTed to the plugin's own route, which mutated and pinged, so the rail moves
  // again, this time driven end to end by chrome the manifest declared.
  await expect(badge).toHaveText('3 stuck', { timeout: 30_000 })

  // The same command is the shortcut target; no second plugin invocation path exists.
  await page.keyboard.press('Meta+Alt+u')
  await expect(badge).toHaveText('4 stuck', { timeout: 30_000 })

  // ── Descriptor promotion: row data → native modal → create, then link ─────────────────────────
  await rows.first().click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByPlaceholder('Task title')).toHaveValue('Ship the thing')
  await modal.getByRole('button', { name: 'Create task' }).click()
  await expect(modal).toBeHidden({ timeout: 30_000 })

  await expect.poll(async () => {
    const tasks = await nodeJson<{ origin: string; links: { providerId: string; identifier: string }[] }[]>(page, '/v2/core/tasks')
    return tasks.some((task) => task.origin === `${PLUGIN_ID}:item`
      && task.links.some((link) => link.providerId === PROVIDER_ID && link.identifier === 'card-1'))
  }, { timeout: 30_000 }).toBe(true)
})
