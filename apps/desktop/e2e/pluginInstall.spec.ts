import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'

// The exit criteria for docs/third-party/phase-5-install-ux.md, as assertions: the full lifecycle from
// Settings with no terminal involved — install, trust, restart, update with a permission change,
// uninstall.
//
// The package is fetched over a real socket rather than copied into place, because "download it and
// unpack it" is the half of the installer a fixture directory would never exercise. The installer takes
// https everywhere plus http on loopback, and this server is why that exception exists.
//
// Local node rather than a paired one, for the same reason pluginFrame.spec.ts gives: distribution is
// phase 2's test, and pairing would add ninety seconds to every assertion here.

const KEY = 'c'.repeat(64)
const PLUGIN_ID = 'e2e-ntfy'

const roots: string[] = []
const apps: ElectronApplication[] = []
const servers: Server[] = []

// A node half with one route, and a client half that exists only so there are BYTES for this device to
// acknowledge — the trust prompt is keyed on a bundle hash, so a package with no client bundle would
// install silently and prove nothing about consent.
const NODE_BUNDLE = `
export default {
  name: ${JSON.stringify(PLUGIN_ID)},
  init(ctx) {
    ctx.routes.fetch(async () => Response.json({ ok: true }))
  },
}
`
const CLIENT_BUNDLE = (version: string) => `export const VERSION = ${JSON.stringify(version)}\n`

/** Lay out a package and tar it into `<dir>/acorn-plugin.tgz`, returning the archive bytes. */
function buildPackage(workshop: string, version: string, permissions: Record<string, unknown> = {}): Uint8Array {
  const dir = mkdtempSync(join(workshop, 'pkg-'))
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'node.js'), NODE_BUNDLE)
  writeFileSync(join(dir, 'dist', 'client.js'), CLIENT_BUNDLE(version))
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: PLUGIN_ID,
    name: 'E2E ntfy',
    version,
    apiVersion: PLUGIN_API_MAJOR,
    node: './dist/node.js',
    client: './dist/client.js',
    permissions: { node: permissions },
  }))
  const archive = join(dir, 'acorn-plugin.tgz')
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', dir, 'acorn-plugin.json', 'dist'])
  return readFileSync(archive)
}

/** One loopback server whose single path answers with whatever `serve()` was last handed. */
async function tarballServer(): Promise<{ url: string; serve: (bytes: Uint8Array) => void }> {
  let current: Uint8Array = new Uint8Array()
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(current.byteLength) })
    res.end(current)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The tarball server did not bind a port.')
  return { url: `http://127.0.0.1:${address.port}/acorn-plugin.tgz`, serve: (bytes) => void (current = bytes) }
}

type PageBridge = {
  nodeFetch(nodeId: string, request: Record<string, unknown>): Promise<{ status: number; body: Uint8Array }>
  fleetList(): Promise<{ nodes: { nodeId: string; local: boolean }[] }>
}
type BridgeWindow = Window & { acorn?: PageBridge }

async function nodeJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (path) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const fleet = await bridge.fleetList()
    const node = fleet.nodes.find((candidate) => candidate.local) ?? fleet.nodes[0]
    if (!node) throw new Error('The fleet is empty — main never adopted the local node.')
    const res = await bridge.nodeFetch(node.nodeId, {
      requestId: `e2e-${Math.random().toString(36).slice(2)}`,
      path,
      method: 'GET',
      headers: {},
    })
    const text = new TextDecoder().decode(res.body)
    if (res.status < 200 || res.status >= 300) throw new Error(`${path}: ${res.status} ${text}`)
    return JSON.parse(text) as T
  }, path)
}

type Roster = { plugins: { name: string; running: boolean; state: string; installed?: { version: string } }[] }
const rosterRow = async (page: Page) => (await nodeJson<Roster>(page, '/v2/core/plugins')).plugins.find((row) => row.name === PLUGIN_ID)

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
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
  return { app, page }
}

const dismissOnboarding = async (page: Page): Promise<void> => {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) await done.click()
}

const settleOverlays = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => {
      await dismissOnboarding(page)
      return page.locator('.overlay-backdrop').count()
    }, { timeout: 30_000 })
    .toBe(0)
}

const openPluginsSettings = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+,')
  await expect(page.locator('.overlay.settings')).toBeVisible({ timeout: 15_000 })
  await page.locator('.settings-nav-item', { hasText: 'Plugins' }).click()
  await expect(page.locator('.plugin-install')).toBeVisible({ timeout: 15_000 })
}

/** Fill the install form with a tarball URL and submit it. */
const installFrom = async (page: Page, url: string): Promise<void> => {
  await page.locator('.plugin-install select').selectOption('url')
  await page.locator('.plugin-install input').fill(url)
  await page.locator('.plugin-install').getByRole('button', { name: 'Install' }).click()
}

/** Accept whichever trust prompt is up, and return the title it used. */
async function acceptTrust(page: Page): Promise<string> {
  const dialog = page.locator('.plugin-trust-dialog')
  await expect(dialog).toBeVisible({ timeout: 60_000 })
  const title = (await dialog.locator('.overlay-title').textContent()) ?? ''
  await dialog.getByRole('button', { name: /^Trust/ }).click()
  await expect(dialog).toHaveCount(0)
  return title
}

/** Click Restart node and wait for the roster to come back with the plugin in the expected shape. */
async function restartAndSettle(page: Page, expected: (row: Awaited<ReturnType<typeof rosterRow>>) => boolean): Promise<void> {
  await page.locator('.settings-notice').getByRole('button', { name: 'Restart node' }).click()
  // Main reloads the renderer after a supervised restart, so the settings modal is gone and every
  // locator from before this point is stale. Poll the node itself instead.
  await expect(page.locator('.shell')).toBeVisible({ timeout: 120_000 })
  await expect
    .poll(async () => {
      // The node has to ANSWER before its answer means anything. While it is restarting nodeJson
      // throws, and folding that into "the row is absent" would let the uninstall assertion pass on
      // the outage rather than on the uninstall.
      const roster = await nodeJson<Roster>(page, '/v2/core/plugins').catch(() => null)
      if (!roster) return 'the node is not answering'
      return expected(roster.plugins.find((row) => row.name === PLUGIN_ID)) ? 'settled' : 'not yet'
    }, { timeout: 120_000 })
    .toBe('settled')
}

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('installs, trusts, updates and uninstalls a plugin from Settings', async () => {
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'acorn-plugin-install-'))
  roots.push(root)
  const workshop = join(root, 'workshop')
  mkdirSync(workshop, { recursive: true })
  const dataDir = join(root, 'data')

  const host = await tarballServer()
  host.serve(buildPackage(workshop, '1.0.0'))

  const { page } = await launch(dataDir)
  await settleOverlays(page)
  // Nothing installed yet — the assertion that the rest of this test is about an install and not about
  // a package that happened to be lying in the data root.
  expect(await rosterRow(page)).toBeUndefined()

  // ── Install ───────────────────────────────────────────────────────────────────────────────────
  await openPluginsSettings(page)
  await installFrom(page, host.url)

  // The node has it, and says so honestly: on disk, not running, restart pending.
  await expect.poll(async () => (await rosterRow(page))?.state, { timeout: 60_000 }).toBe('pending-restart')

  // ── Trust, from the install flow rather than at the next boot ──────────────────────────────────
  expect(await acceptTrust(page)).toBe('Run a plugin from this node?')

  // ── Restart, and the plugin is live ───────────────────────────────────────────────────────────
  await openPluginsSettings(page)
  await restartAndSettle(page, (row) => row?.state === 'active' && row.running)
  expect((await rosterRow(page))?.installed?.version).toBe('1.0.0')

  // ── Update, with a permission the old version did not ask for ─────────────────────────────────
  host.serve(buildPackage(workshop, '1.1.0', { exec: true }))
  await settleOverlays(page)
  await openPluginsSettings(page)
  await page.locator('.plugin-row', { hasText: PLUGIN_ID }).getByRole('button', { name: 'Update' }).click()
  await expect.poll(async () => (await rosterRow(page))?.installed?.version, { timeout: 60_000 }).toBe('1.1.0')

  // A different bundle is a different decision, and this one is framed as an update — which is what
  // makes the added permission visible instead of arriving inside a version bump.
  const dialog = page.locator('.plugin-trust-dialog')
  await expect(dialog).toBeVisible({ timeout: 60_000 })
  await expect(dialog.locator('.overlay-title')).toHaveText('A plugin has been updated')
  await expect(dialog.locator('.plugin-trust-permissions li.added')).toHaveText('Run commands on the node')
  await dialog.getByRole('button', { name: 'Trust the update' }).click()
  await expect(dialog).toHaveCount(0)

  // ── Uninstall ─────────────────────────────────────────────────────────────────────────────────
  await openPluginsSettings(page)
  const row = page.locator('.plugin-row', { hasText: PLUGIN_ID })
  await row.getByRole('button', { name: 'Uninstall' }).click()
  // Keeping the data is the plain button; deleting it is the loud one, and the two are separate clicks
  // rather than a checkbox inside a confirmation.
  await row.getByRole('button', { name: 'Keep its data' }).click()

  // Still serving until the restart, which the row says rather than pretending it is already gone.
  await expect.poll(async () => (await rosterRow(page))?.state, { timeout: 60_000 }).toBe('pending-restart')
  await restartAndSettle(page, (row) => row === undefined)
})
