import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEY = 'e'.repeat(64)
const roots: string[] = []
const apps: ElectronApplication[] = []

type RunningApp = { app: ElectronApplication; page: Page; dataDir: string; repoDir: string }
type QueuedAgentSeed = { sessionId: string; alternateSessionId: string; firstTurnId: string; secondTurnId: string }

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`

function seedQueuedAgent(dataDir: string, taskId: string): QueuedAgentSeed {
  const sessionId = randomUUID()
  const completedTurnId = randomUUID()
  const alternateSessionId = randomUUID()
  const alternateTurnId = randomUUID()
  const firstTurnId = randomUUID()
  const secondTurnId = randomUUID()
  const timestamp = Date.now()
  const insertTurn = (id: string, ordinal: number, prompt: string) => `
    INSERT INTO agent_turns (
      id, session_id, ordinal, source, status, input_json, effective_policy_json,
      idempotency_key, attempt, created_at
    ) VALUES (
      ${sqlText(id)}, ${sqlText(sessionId)}, ${ordinal}, 'interactive', 'queued',
      ${sqlText(JSON.stringify([{ type: 'text', text: prompt }]))}, '{}',
      ${sqlText(randomUUID())}, 0, ${timestamp + ordinal}
    );`
  // core.sqlite, not V1's acorn.sqlite (node-core/main/serverPaths.ts). Naming the old file here did
  // not just miss the tables — `sqlite3` creates what it cannot open, and openDataRoot then refuses a
  // data root that contains a V1 database, so the next launch would have failed too.
  execFileSync('sqlite3', [join(dataDir, 'core.sqlite'), `
    BEGIN;
    INSERT INTO agent_sessions (
      id, task_id, provider_id, profile_id, kind, driver_kind, driver_version,
      controller, runtime_state, attention, status_authority, title, config_json,
      last_event_seq, last_read_seq, created_at, updated_at
    ) VALUES (
      ${sqlText(sessionId)}, ${sqlText(taskId)}, 'codex', 'codex', 'interactive',
      'codex-app-server', 'e2e', 'acorn', 'failed', 'error', 'protocol',
      'Queued controls smoke', '{}', 5, 0, ${timestamp}, ${timestamp}
    );
    INSERT INTO agent_sessions (
      id, task_id, provider_id, profile_id, kind, driver_kind, driver_version,
      controller, runtime_state, attention, status_authority, title, config_json,
      last_event_seq, last_read_seq, created_at, updated_at
    ) VALUES (
      ${sqlText(alternateSessionId)}, ${sqlText(taskId)}, 'claude', 'claude-code', 'interactive',
      'claude-acp', 'e2e', 'acorn', 'ready', 'none', 'protocol',
      'Alternate agent', '{}', 3, 0, ${timestamp - 100}, ${timestamp - 90}
    );
    INSERT INTO agent_turns (
      id, session_id, ordinal, source, status, input_json, effective_policy_json,
      idempotency_key, attempt, created_at, started_at, completed_at, stop_reason
    ) VALUES (
      ${sqlText(completedTurnId)}, ${sqlText(sessionId)}, 0, 'interactive', 'completed',
      ${sqlText(JSON.stringify([{ type: 'text', text: 'Explain the smoke.' }]))}, '{}',
      ${sqlText(randomUUID())}, 1, ${timestamp - 10}, ${timestamp - 9}, ${timestamp - 5}, 'completed'
    );
    INSERT INTO agent_events (id, session_id, turn_id, seq, schema_version, event_json, search_text, created_at) VALUES
      (${sqlText(randomUUID())}, ${sqlText(sessionId)}, ${sqlText(completedTurnId)}, 1, 1,
        ${sqlText(JSON.stringify({ type: 'user_message', text: 'Explain the smoke.' }))}, 'Explain the smoke.', ${timestamp - 9}),
      (${sqlText(randomUUID())}, ${sqlText(sessionId)}, ${sqlText(completedTurnId)}, 2, 1,
        ${sqlText(JSON.stringify({ type: 'reasoning', text: 'I should explain ', messageId: 'reason-1', append: true }))}, 'I should explain ', ${timestamp - 8}),
      (${sqlText(randomUUID())}, ${sqlText(sessionId)}, ${sqlText(completedTurnId)}, 3, 1,
        ${sqlText(JSON.stringify({ type: 'reasoning', text: 'this clearly.', messageId: 'reason-1', append: true }))}, 'this clearly.', ${timestamp - 7}),
      (${sqlText(randomUUID())}, ${sqlText(sessionId)}, ${sqlText(completedTurnId)}, 4, 1,
        ${sqlText(JSON.stringify({ type: 'assistant_message', text: 'The managed response is visible.' }))}, 'The managed response is visible.', ${timestamp - 6}),
      (${sqlText(randomUUID())}, ${sqlText(sessionId)}, ${sqlText(completedTurnId)}, 5, 1,
        ${sqlText(JSON.stringify({ type: 'turn_completed', stopReason: 'completed' }))}, 'completed', ${timestamp - 5});
    INSERT INTO agent_turns (
      id, session_id, ordinal, source, status, input_json, effective_policy_json,
      idempotency_key, attempt, created_at, started_at, completed_at, stop_reason
    ) VALUES (
      ${sqlText(alternateTurnId)}, ${sqlText(alternateSessionId)}, 0, 'interactive', 'completed',
      ${sqlText(JSON.stringify([{ type: 'text', text: 'Show the alternate transcript.' }]))}, '{}',
      ${sqlText(randomUUID())}, 1, ${timestamp - 99}, ${timestamp - 98}, ${timestamp - 94}, 'completed'
    );
    INSERT INTO agent_events (id, session_id, turn_id, seq, schema_version, event_json, search_text, created_at) VALUES
      (${sqlText(randomUUID())}, ${sqlText(alternateSessionId)}, ${sqlText(alternateTurnId)}, 1, 1,
        ${sqlText(JSON.stringify({ type: 'user_message', text: 'Show the alternate transcript.' }))}, 'Show the alternate transcript.', ${timestamp - 98}),
      (${sqlText(randomUUID())}, ${sqlText(alternateSessionId)}, ${sqlText(alternateTurnId)}, 2, 1,
        ${sqlText(JSON.stringify({ type: 'assistant_message', text: 'This is the alternate agent response.' }))}, 'This is the alternate agent response.', ${timestamp - 96}),
      (${sqlText(randomUUID())}, ${sqlText(alternateSessionId)}, ${sqlText(alternateTurnId)}, 3, 1,
        ${sqlText(JSON.stringify({ type: 'turn_completed', stopReason: 'completed' }))}, 'completed', ${timestamp - 94});
    ${insertTurn(firstTurnId, 1, 'First queued prompt.')}
    ${insertTurn(secondTurnId, 2, 'Second queued prompt.')}
    COMMIT;
  `])
  return { sessionId, alternateSessionId, firstTurnId, secondTurnId }
}

// The window holds no credential of its own: every request goes through Electron main's connection
// broker, which owns the endpoint and the device bearer (docs/vNext/architecture.md § How the client
// talks to nodes). So the suite seeds through the same bridge the renderer's apiClient uses. Raw
// `fetch('/v2/…')` from the page worked only because the e2e launch established a session cookie
// first; there is no login left to establish one.
type NodeFetchResult = { status: number; body: Uint8Array }
type PageBridge = {
  nodeFetch(nodeId: string, request: Record<string, unknown>): Promise<NodeFetchResult>
  nodeSend(nodeId: string, frame: unknown): void
  onNodeFrame(cb: (nodeId: string, frame: unknown) => void): () => void
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

async function launch(previous?: Pick<RunningApp, 'dataDir' | 'repoDir'>): Promise<RunningApp> {
  const root = previous ? null : mkdtempSync(join(tmpdir(), 'acorn-e2e-'))
  if (root) roots.push(root)
  const dataDir = previous?.dataDir ?? join(root!, 'data')
  const repoDir = previous?.repoDir ?? join(root!, 'repo')
  if (!previous) {
    execFileSync('git', ['init', '-q', repoDir])
    execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'e2e@acorn.test'])
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Acorn E2E'])
    execFileSync('git', ['-C', repoDir, 'remote', 'add', 'origin', 'https://github.com/acorn/smoke.git'])
    execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-qm', 'init'])
  }
  const app = await electron.launch({
    // Per-run Chromium profile. The renderer's origin is now the constant app://acorn, so its
    // IndexedDB bucket — which holds the persisted TanStack cache — is shared by every launch that
    // shares a userData dir. Under the old http origin the port was random, so each launch got a fresh
    // bucket by accident; without this, one test's cached (and still-fresh) task list rehydrates into
    // the next test's window. Keyed to dataDir so a relaunch of the SAME app keeps its cache and its
    // device token.
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

async function seedWorkspace(page: Page, repoDir: string): Promise<void> {
  const workspace = await nodeJson<{ id: string }>(page, '/v2/core/workspaces', { method: 'POST', body: { name: 'Smoke' } })
  await nodeJson(page, `/v2/core/workspaces/${workspace.id}/repos`, { method: 'POST', body: { owner: 'acorn', name: 'smoke' } })
  await nodeJson(page, '/v2/p/terminal/terminal/repo-path', { method: 'PUT', body: { owner: 'acorn', repo: 'smoke', path: repoDir } })
}

async function seedTask(page: Page, repoDir: string): Promise<{ id: string }> {
  await seedWorkspace(page, repoDir)
  return nodeJson<{ id: string }>(page, '/v2/core/tasks', {
    method: 'POST',
    body: { origin: 'local', repoOwner: 'acorn', repoName: 'smoke', branch: 'main', title: 'Smoke task' },
  })
}

async function dismissOnboarding(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) await done.click()
}

async function openSmokeWorkspace(page: Page): Promise<void> {
  // Workspace creation happens outside the renderer query cache. Navigate to the stable workspace
  // route, then reload that route so both workspace selection and task queries start from SQLite
  // instead of the pre-seed in-memory cache.
  await page.goto(new URL('/acorn/smoke', page.url()).toString())
  await page.reload()
  await expect(page.locator('.shell')).toBeVisible()
  await dismissOnboarding(page)
}

async function createTerminalAndCapture(page: Page, taskId: string, command: string): Promise<string> {
  const session = await nodeJson<{ id: string }>(page, '/v2/p/terminal/terminal/sessions', {
    method: 'POST', body: { taskId, profileId: 'shell', command, title: 'Smoke terminal' },
  })
  // The socket belongs to main too — the bearer rides the upgrade headers, which a page cannot set —
  // so attaching is `nodeSend` + `onNodeFrame`, exactly what client-core/wsClient.ts does. That is
  // also why WS_PATH is no longer needed here: the page never sees the URL.
  return page.evaluate(async ({ sessionId }) => {
    const bridge = (window as BridgeWindow).acorn
    if (!bridge) throw new Error('The node broker bridge is missing.')
    const fleet = await bridge.fleetList()
    const node = fleet.nodes.find((candidate) => candidate.local) ?? fleet.nodes[0]
    if (!node) throw new Error('The fleet is empty — main never adopted the local node.')
    return new Promise<string>((resolve, reject) => {
      let output = ''
      const off = bridge.onNodeFrame((_nodeId, raw) => {
        const frame = raw as { channel?: string; id?: string; msg?: { type: string; data?: string } }
        if (frame.channel !== 'term:out' || frame.id !== sessionId || !frame.msg) return
        if (frame.msg.type === 'output') output += frame.msg.data ?? ''
        if (frame.msg.type === 'exit') { window.clearTimeout(timer); off(); resolve(output) }
      })
      const timer = window.setTimeout(() => { off(); reject(new Error(`terminal output timeout: ${output}`)) }, 8_000)
      bridge.nodeSend(node.nodeId, { channel: 'term:attach', id: sessionId })
    })
  }, { sessionId: session.id })
}

test.afterEach(async () => {
  // Per-test cleanup happens after the Electron process has released SQLite and PTY handles.
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('S1 boots the authenticated desktop shell', async () => {
  const running = await launch()
  await expect(running.page.locator('.brand')).toContainText('acorn')
  await running.app.close()
})

test('S2 restores durable task state across two launches', async () => {
  const first = await launch()
  await seedTask(first.page, first.repoDir)
  await openSmokeWorkspace(first.page)
  await first.page.getByRole('button', { name: 'Smoke task' }).click()
  await expect(first.page.locator('.task-layout')).toBeVisible()
  await first.app.close()
  const second = await launch(first)
  await expect(second.page.getByRole('button', { name: 'Smoke task' })).toBeVisible()
  await second.app.close()
})

test('S3 opens a task from the rail', async () => {
  const running = await launch()
  await seedTask(running.page, running.repoDir)
  await openSmokeWorkspace(running.page)
  await running.page.getByRole('button', { name: 'Smoke task' }).click()
  await expect(running.page.locator('.task-layout')).toBeVisible()
  await running.app.close()
})

test('S4 streams terminal echo through the authenticated WebSocket', async () => {
  const running = await launch()
  const task = await seedTask(running.page, running.repoDir)
  const output = await createTerminalAndCapture(running.page, task.id, "printf 'ACORN_E2E_ECHO\\n'")
  expect(output).toContain('ACORN_E2E_ECHO')
  await running.app.close()
})

test('S5 quit tears down a live PTY child', async () => {
  const running = await launch()
  const task = await seedTask(running.page, running.repoDir)
  const pidFile = join(running.repoDir, 'pty.pid')
  await nodeJson(running.page, '/v2/p/terminal/terminal/sessions', {
    method: 'POST',
    body: { taskId: task.id, profileId: 'shell', command: `echo $$ > '${pidFile}'; sleep 30`, title: 'Quit smoke' },
  })
  await expect.poll(() => existsSync(pidFile)).toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  await running.app.close()
  await expect.poll(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }).toBe(true)
})

test('S6 find-in-files copies paths and double-clicks into the match', async () => {
  test.setTimeout(60_000)
  const running = await launch()
  const path = 'search-target.ts'
  writeFileSync(join(running.repoDir, path), "const value = 'needleToken'\n")
  execFileSync('git', ['-C', running.repoDir, 'add', path])
  execFileSync('git', ['-C', running.repoDir, 'commit', '-qm', 'add search target'])
  await seedWorkspace(running.page, running.repoDir)
  await openSmokeWorkspace(running.page)
  await running.page.getByRole('button', { name: 'New task' }).click()
  await running.page.getByRole('checkbox', { name: 'Use current checkout (no worktree)' }).check()
  await running.page.getByPlaceholder('Task title').fill('Smoke task')
  await running.page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(running.page.locator('.task-layout')).toBeVisible({ timeout: 30_000 })
  const tasks = await nodeJson<{ id: string; title: string }[]>(running.page, '/v2/core/tasks')
  const task = tasks.find((candidate) => candidate.title === 'Smoke task')
  if (!task) throw new Error('The current-checkout task was not persisted.')
  const files = await nodeJson<string[]>(running.page, `/v2/p/editor/tasks/${task.id}/editor/files`)
  expect(files).toContain(path)
  await running.page.keyboard.press('Meta+Shift+f')
  await expect(running.page.locator('.search-pane')).toBeVisible()
  await running.page.getByPlaceholder('Search in files…').fill('needleToken')

  const fileHead = running.page.locator('.search-file-head').filter({ hasText: path })
  await expect(fileHead).toBeVisible()
  await running.page.evaluate(() => {
    const state = window as Window & { __acornCopiedText?: string }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { state.__acornCopiedText = text } },
    })
  })
  await fileHead.hover()
  await fileHead.getByRole('button', { name: 'Copy file path' }).click()
  expect(await running.page.evaluate(() => (window as Window & { __acornCopiedText?: string }).__acornCopiedText)).toBe(path)

  const hit = running.page.locator('.search-hit').filter({ hasText: 'needleToken' })
  await hit.click()
  await expect(running.page.locator('.editor-pane')).toHaveCount(0)
  await hit.dblclick()
  await expect(running.page.locator('.editor-tab.active')).toContainText(path)
  await expect(running.page.getByRole('textbox', { name: 'Editor content' })).toBeFocused()
  await running.page.keyboard.type('X')
  await running.page.keyboard.press('Meta+s')
  await expect.poll(async () =>
    (await nodeJson<{ text: string }>(running.page, `/v2/p/editor/tasks/${task.id}/editor/read?path=${encodeURIComponent(path)}`)).text,
  ).toContain("'XneedleToken'")
  await running.app.close()
})

test('S8 survives a hard reload of a deep route under the app scheme', async () => {
  const running = await launch()
  await seedWorkspace(running.page, running.repoDir)
  await running.page.goto(new URL('/acorn/smoke/1', running.page.url()).toString())
  // The regression guard for two things at once: the protocol handler's index.html fallback (a deep
  // path is a client route, not a file), and base:'/' (a relative base would resolve /assets/* against
  // /acorn/smoke and fail the module script's MIME check → blank window).
  await running.page.reload()
  await expect(running.page.locator('.shell')).toBeVisible()
  expect(running.page.url()).toBe('app://acorn/acorn/smoke/1')
  await running.app.close()
})

test('S7 loads the Agent Center and combines task agent switching with the conversation', async () => {
  test.setTimeout(150_000)
  const first = await launch()
  const task = await seedTask(first.page, first.repoDir)
  writeFileSync(join(first.repoDir, 'agent-smoke.ts'), 'export const agentSmoke = true\n')
  await first.app.close()
  seedQueuedAgent(first.dataDir, task.id)
  const running = await launch(first)
  await openSmokeWorkspace(running.page)
  await expect(running.page.getByRole('button', { name: 'Smoke task' })).toBeVisible()

  await running.page.locator('.tabrail-source[aria-label="Agents"]').click()
  await expect(running.page.locator('.agent-center')).toBeVisible()
  await expect(running.page.getByRole('heading', { name: 'Agent Center' })).toBeVisible()
  await expect(running.page.locator('.agent-center-launch')).toHaveCount(0)

  await running.page.locator('.tabrail-task[aria-label="Smoke task"]').click({ noWaitAfter: true })
  await expect.poll(() => running.page.evaluate(() => !!document.querySelector('.task-layout'))).toBe(true)
  await expect.poll(() => running.page.evaluate(() =>
    !!document.querySelector('.pane-switch-btn[aria-label="Agent"]'))).toBe(true)
  await running.page.evaluate(() => {
    const button = document.querySelector('.pane-switch-btn[aria-label="Agent"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Task Agent pane button is missing.')
    button.click()
  })
  // Task context used to be asserted by watching page responses; broker traffic never touches the page,
  // so ask the node the same question the pane asks and let the attached chip below prove the pane got it.
  expect(await nodeJson<{ sections: unknown[] }>(running.page, `/v2/core/tasks/${task.id}/context`)).toBeTruthy()
  await expect.poll(() => running.page.evaluate(() => ({
    pane: !!document.querySelector('.managed-agent-pane'),
    sidebar: !!document.querySelector('.agent-task-sidebar[aria-label="Agents in this task"]'),
    conversation: !!document.querySelector('.managed-agent-conversation'),
  }))).toEqual({ pane: true, sidebar: true, conversation: true })
  await expect.poll(() => running.page.evaluate(() => ({
    chip: document.querySelector('.agent-context-chip')?.textContent ?? '',
    error: document.querySelector('.agent-composer-error')?.textContent ?? '',
  })), { timeout: 15_000 }).toEqual({
    chip: expect.stringContaining('Task context · attached'),
    error: '',
  })
  const openContextPicker = () => running.page.evaluate(async () => {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const popover = document.querySelector('.repo-picker-popover')
      if (popover) {
        const taskContext = [...popover.querySelectorAll('.repo-picker-name')]
          .find((candidate) => candidate.textContent?.includes('Task context'))
        return {
          text: popover.textContent ?? '',
          taskContextDisabled: taskContext instanceof HTMLButtonElement && taskContext.disabled,
        }
      }
      const button = document.querySelector('button[aria-label="Add Acorn context"]')
      if (!(button instanceof HTMLButtonElement)) throw new Error('Context picker trigger is missing.')
      button.click()
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    throw new Error('Context picker did not open.')
  })
  await expect(openContextPicker()).resolves.toEqual({
    text: expect.stringContaining('Docker service state'),
    taskContextDisabled: true,
  })
  const contextPickerText = await running.page.evaluate(() =>
    document.querySelector('.repo-picker-popover')?.textContent ?? '')
  expect(contextPickerText).not.toContain('Current worktree changes')
  expect(contextPickerText).not.toContain('Editor files')
  expect(contextPickerText).not.toContain('Preview page')
  expect(contextPickerText).not.toContain('Workflow runs')
  await expect(running.page.evaluate(async () => {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog) {
        return {
          dialog: dialog.textContent ?? '',
          attach: [...dialog.querySelectorAll('button')]
            .some((candidate) => candidate.textContent?.trim() === 'Attach'),
        }
      }
      const button = [...document.querySelectorAll('.repo-picker-popover .repo-picker-name')]
        .find((candidate) => candidate.textContent?.includes('Docker service state'))
      if (button instanceof HTMLButtonElement) button.click()
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    throw new Error('Docker context selection modal did not open.')
  })).resolves.toEqual({
    dialog: expect.stringContaining('Add Docker service state'),
    attach: true,
  })
  await running.page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Cancel')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Context modal cancel button is missing.')
    button.click()
  })
  await expect(openContextPicker()).resolves.toEqual({
    text: expect.stringContaining('Docker service state'),
    taskContextDisabled: true,
  })
  await running.page.evaluate(() => {
    const target = document.querySelector('.managed-agent-conversation')
    if (!(target instanceof HTMLElement)) throw new Error('Managed conversation is missing.')
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  await expect.poll(() => running.page.evaluate(() =>
    document.querySelectorAll('.repo-picker-popover').length)).toBe(0)

  await running.page.evaluate(() => {
    const button = document.querySelector('.agent-context-chip .agent-chip-remove')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Task-context remove button is missing.')
    button.click()
  })
  await expect.poll(() => running.page.evaluate(() =>
    document.querySelectorAll('.agent-context-chip').length)).toBe(0)

  await running.page.evaluate(() => {
    const textarea = document.querySelector('textarea[aria-label="Message agent"]')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Agent composer is missing.')
    textarea.focus()
    textarea.value = 'Inspect @agent'
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  })
  await expect.poll(() => running.page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')]
      .some((candidate) => candidate.textContent?.includes('agent-smoke.ts')))).toBe(true)
  await running.page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent?.includes('agent-smoke.ts'))
    if (!(button instanceof HTMLButtonElement)) throw new Error('File mention suggestion is missing.')
    button.click()
  })
  await expect.poll(() => running.page.evaluate(() =>
    (document.querySelector('textarea[aria-label="Message agent"]') as HTMLTextAreaElement | null)?.value ?? ''))
    .toBe('Inspect @agent-smoke.ts ')
  const combinedGeometry = await running.page.evaluate(() => {
    const pane = document.querySelector('.managed-agent-pane')?.getBoundingClientRect()
    const slot = document.querySelector('.task-slot[data-pane-id="agents"]')?.getBoundingClientRect()
    const sidebar = document.querySelector('.agent-task-sidebar')?.getBoundingClientRect()
    const conversation = document.querySelector('.managed-agent-conversation')?.getBoundingClientRect()
    return {
      paneWidth: pane?.width ?? 0,
      slotWidth: slot?.width ?? 0,
      sidebarX: sidebar?.x ?? 0,
      conversationX: conversation?.x ?? 0,
    }
  })
  expect(combinedGeometry.paneWidth).toBeGreaterThan(combinedGeometry.slotWidth - 2)
  expect(combinedGeometry.sidebarX).toBeLessThan(combinedGeometry.conversationX)

  const clickAgentHeaderButton = (label: string) => running.page.evaluate((accessibleName) => {
    const button = [...document.querySelectorAll('.managed-agent-head button')]
      .find((candidate) => candidate.getAttribute('aria-label') === accessibleName || candidate.textContent?.trim() === accessibleName)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Agent header action is missing: ${accessibleName}`)
    button.click()
  }, label)
  const clickConversationOutside = () => running.page.evaluate(() => {
    const target = document.querySelector('.managed-agent-conversation')
    if (!(target instanceof HTMLElement)) throw new Error('Managed conversation is missing.')
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    target.click()
  })
  const headerExpanded = (label: string) => running.page.evaluate((accessibleName) => {
    const button = [...document.querySelectorAll('.managed-agent-head button')]
      .find((candidate) => candidate.getAttribute('aria-label') === accessibleName || candidate.textContent?.trim() === accessibleName)
    return button?.getAttribute('aria-expanded') === 'true'
  }, label)
  await clickAgentHeaderButton('Session actions')
  expect(await headerExpanded('Session actions')).toBe(true)
  await clickConversationOutside()
  expect(await headerExpanded('Session actions')).toBe(false)
  await clickAgentHeaderButton('New')
  expect(await headerExpanded('New')).toBe(true)
  await clickConversationOutside()
  expect(await headerExpanded('New')).toBe(false)

  await expect.poll(() => running.page.evaluate(() => ({
    user: document.querySelector('.agent-message-user')?.textContent ?? '',
    reasoning: document.querySelector('.agent-reasoning')?.textContent ?? '',
    assistant: document.querySelector('.agent-message-assistant')?.textContent ?? '',
    completed: document.querySelector('.agent-turn-complete')?.textContent ?? '',
  }))).toEqual({
    user: expect.stringContaining('Explain the smoke.'),
    reasoning: expect.stringContaining('I should explain this clearly.'),
    assistant: expect.stringContaining('The managed response is visible.'),
    completed: expect.stringContaining('Turn complete'),
  })

  const queuedState = () => running.page.evaluate(() =>
    [...document.querySelectorAll('.agent-queued-turn')].map((row) => ({
      text: row.querySelector('p')?.textContent ?? '',
      iconButtons: row.querySelectorAll('.ui-btn[data-icon-only] svg').length,
    })))
  const clickQueuedAction = (rowIndex: number, label: string) => running.page.evaluate(
    ({ rowIndex, label }) => {
      const row = document.querySelectorAll('.agent-queued-turn').item(rowIndex)
      const button = [...row.querySelectorAll('button')]
        .find((candidate) => candidate.getAttribute('aria-label') === label)
      if (!button) throw new Error(`Queued action is missing: ${label}`)
      if (button.disabled) throw new Error(`Queued action is still busy: ${label}`)
      button.click()
    },
    { rowIndex, label },
  )
  const queuedActionEnabled = (rowIndex: number, label: string) => running.page.evaluate(
    ({ rowIndex, label }) => {
      const row = document.querySelectorAll('.agent-queued-turn').item(rowIndex)
      const button = [...row.querySelectorAll('button')]
        .find((candidate) => candidate.getAttribute('aria-label') === label)
      return button != null && !button.disabled
    },
    { rowIndex, label },
  )
  await expect.poll(queuedState).toHaveLength(2)
  expect((await queuedState())[0]?.iconButtons).toBe(4)
  await clickQueuedAction(0, 'Edit queued prompt')
  await running.page.evaluate(() => {
    const textarea = document.querySelector('.agent-queued-turn textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Queued prompt editor did not open.')
    textarea.value = 'Edited first queued prompt.'
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  })
  await clickQueuedAction(0, 'Save queued prompt')
  await expect.poll(queuedState).toEqual([
    expect.objectContaining({ text: 'Edited first queued prompt.' }),
    expect.objectContaining({ text: 'Second queued prompt.' }),
  ])

  await expect.poll(() => queuedActionEnabled(0, 'Move queued turn down')).toBe(true)
  await clickQueuedAction(0, 'Move queued turn down')
  await expect.poll(queuedState).toEqual([
    expect.objectContaining({ text: 'Second queued prompt.' }),
    expect.objectContaining({ text: 'Edited first queued prompt.' }),
  ])
  await expect.poll(() => queuedActionEnabled(1, 'Remove queued prompt')).toBe(true)
  await clickQueuedAction(1, 'Remove queued prompt')
  await expect.poll(queuedState).toEqual([
    expect.objectContaining({ text: 'Second queued prompt.' }),
  ])

  await running.page.evaluate(() => {
    const row = [...document.querySelectorAll('.managed-agent-session-row')]
      .find((candidate) => candidate.textContent?.includes('Alternate agent'))
    if (!(row instanceof HTMLElement)) throw new Error('Alternate managed session row is missing.')
    row.click()
  })
  await expect.poll(() => running.page.evaluate(() => ({
    heading: document.querySelector('.managed-agent-heading')?.textContent ?? '',
    assistant: document.querySelector('.agent-message-assistant')?.textContent ?? '',
  }))).toEqual({
    heading: expect.stringContaining('Alternate agent'),
    assistant: expect.stringContaining('This is the alternate agent response.'),
  })
  expect(await running.page.evaluate(() =>
    document.querySelectorAll('.pane-switch-btn[aria-label="Agents"]').length)).toBe(0)

  await running.page.evaluate(() => {
    const trigger = document.querySelector('.managed-agent-usage-trigger')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Agent utilization trigger is missing.')
    trigger.focus()
  })
  await expect.poll(() => running.page.evaluate(() => {
    const tooltip = document.querySelector('.managed-agent-usage-tooltip')
    return tooltip ? getComputedStyle(tooltip).visibility : 'missing'
  })).toBe('visible')

  running.page.once('dialog', (dialog) => dialog.accept())
  await clickAgentHeaderButton('Session actions')
  await running.page.evaluate(() => {
    const button = [...document.querySelectorAll('.repo-picker-popover .repo-picker-name')]
      .find((candidate) => candidate.textContent?.trim() === 'Delete permanently…')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Delete session action is missing.')
    button.click()
  })
  await expect.poll(() => running.page.evaluate(() => ({
    alternatePresent: [...document.querySelectorAll('.managed-agent-session-row')]
      .some((row) => row.textContent?.includes('Alternate agent')),
    heading: document.querySelector('.managed-agent-heading')?.textContent ?? '',
    notFound: document.querySelector('.managed-agent-conversation')?.textContent
      ?.includes('Managed agent session not found') ?? false,
  }))).toEqual({
    alternatePresent: false,
    heading: expect.stringContaining('Queued controls smoke'),
    notFound: false,
  })
  await running.app.close()
})
