import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEY = 'e'.repeat(64)
const roots: string[] = []
const apps: ElectronApplication[] = []

type RunningApp = { app: ElectronApplication; page: Page; dataDir: string; repoDir: string }

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
    args: ['out/main/index.js'],
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

async function seedTask(page: Page, repoDir: string) {
  return page.evaluate(async ({ repoDir }) => {
    const json = (url: string, init?: RequestInit) => fetch(url, init).then(async (response) => {
      if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`)
      return response.json()
    })
    const workspace = await json('/api/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Smoke' }),
    })
    await json(`/api/workspaces/${workspace.id}/repos`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: 'acorn', name: 'smoke' }),
    })
    await json('/api/terminal/repo-path', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: 'acorn', repo: 'smoke', path: repoDir }),
    })
    return json('/api/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'local', repoOwner: 'acorn', repoName: 'smoke', branch: 'main', title: 'Smoke task' }),
    })
  }, { repoDir }) as Promise<{ id: string }>
}

async function dismissOnboarding(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) await done.click()
}

async function createTerminalAndCapture(page: Page, taskId: string, command: string): Promise<string> {
  return page.evaluate(async ({ taskId, command }) => {
    const response = await fetch('/api/terminal/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, profileId: 'shell', command, title: 'Smoke terminal' }),
    })
    if (!response.ok) throw new Error(await response.text())
    const session = await response.json() as { id: string }
    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
      let output = ''
      const timer = window.setTimeout(() => { ws.close(); reject(new Error(`terminal output timeout: ${output}`)) }, 8_000)
      ws.onopen = () => ws.send(JSON.stringify({ channel: 'term:attach', id: session.id }))
      ws.onmessage = (event) => {
        const frame = JSON.parse(String(event.data))
        if (frame.channel !== 'term:out' || frame.id !== session.id) return
        if (frame.msg.type === 'output') output += frame.msg.data
        if (frame.msg.type === 'exit') { clearTimeout(timer); ws.close(); resolve(output) }
      }
    })
  }, { taskId, command })
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
  await first.page.reload()
  await dismissOnboarding(first.page)
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
  await running.page.reload()
  await dismissOnboarding(running.page)
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
  await running.page.evaluate(async ({ taskId, pidFile }) => {
    const response = await fetch('/api/terminal/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, profileId: 'shell', command: `echo $$ > '${pidFile}'; sleep 30`, title: 'Quit smoke' }),
    })
    if (!response.ok) throw new Error(await response.text())
  }, { taskId: task.id, pidFile })
  await expect.poll(() => existsSync(pidFile)).toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  await running.app.close()
  await expect.poll(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }).toBe(true)
})

test('S6 find-in-files copies paths and double-clicks into the match', async () => {
  const running = await launch()
  const path = 'search-target.ts'
  writeFileSync(join(running.repoDir, path), "const value = 'needleToken'\n")
  execFileSync('git', ['-C', running.repoDir, 'add', path])
  execFileSync('git', ['-C', running.repoDir, 'commit', '-qm', 'add search target'])
  const task = await seedTask(running.page, running.repoDir)
  await running.page.evaluate(async (taskId) => {
    const response = await fetch(`/api/tasks/${taskId}/use-checkout`, { method: 'POST' })
    if (!response.ok) throw new Error(await response.text())
  }, task.id)
  await running.page.reload()
  await dismissOnboarding(running.page)
  await running.page.getByRole('button', { name: 'Smoke task' }).click()
  const files = await running.page.evaluate(async (taskId) => {
    const response = await fetch(`/api/tasks/${taskId}/editor/files`)
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<string[]>
  }, task.id)
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
  await expect.poll(() => running.page.evaluate(async ({ taskId, path }) => {
    const response = await fetch(`/api/tasks/${taskId}/editor/read?path=${encodeURIComponent(path)}`)
    return (await response.json() as { text: string }).text
  }, { taskId: task.id, path })).toContain("'XneedleToken'")
  await running.app.close()
})
