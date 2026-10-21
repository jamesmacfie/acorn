// The engine records a run when a run target, setup script, or teardown script ends, with real PTYs
// against this plugin's migrated database (docs/terminal/run-targets.md § Run history).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { terminalRuns } from '../node/schema'

vi.mock('@acorn/plugin-api/node', () => ({
  lowerPriority: () => {},
  getProfile: () => ({ id: 'shell', label: 'Shell', kind: 'shell', backendPreference: 'node-pty' }),
  interactiveProfile: () => true,
  resolveCommand: () => '/bin/cat',
  tmuxAvailable: () => false,
  buildSessionEnv: () => ({ PATH: '/usr/bin:/bin', SHELL: '/bin/sh', LANG: 'en_US.UTF-8' }),
  rendererBaseCheckout: () => undefined,
  taskContext: () => ({ repo: null, pull: null }),
  createLogger: () => ({ warn() {} }),
  describeError: (error: Error) => ({ message: error.message }),
  invalidateWorktreeStatus() {},
  TEARDOWN_TIMEOUT_MS: 120000,
  acornMcp: () => null,
  launcherSpec: () => ({}),
  serverName: () => 'fixture',
  resolveMcpEntry: () => 'fixture',
  childEnv: () => ({ PATH: '/usr/bin:/bin', SHELL: '/bin/sh', LANG: 'en_US.UTF-8' }),
  registerAcornMcpBeforeSpawn() {},
  listProfiles: () => [],
}))
import { disposeTerminal, registerTerminalChannel, terminalRunGlue } from './terminal'

let fixture: TestPluginDb | undefined
let dir = ''

afterEach(() => {
  disposeTerminal()
  fixture?.cleanup()
  fixture = undefined
  rmSync(dir, { recursive: true, force: true })
})

function engine(setup: string | null = null) {
  dir = mkdtempSync(join(tmpdir(), 'acorn-terminal-runs-'))
  fixture = makeTestPluginDb('terminal')
  const report = () => {}
  const core = {
    taskScripts: {
      takeSetup: () => (setup ? { script: setup, identity: { attemptId: 'a', generation: 1 } } : null),
      report,
      forSession: () => null,
      reconcile: () => {},
    },
    tasks: {
      load: async (id: string) => ({ id, projectId: null }),
      resolveCwd: async () => ({ cwd: dir, isWorktree: true }),
    },
    projects: {},
    proc: {},
    git: {},
  }
  const registrations = registerTerminalChannel(fixture.db as never, core as never, {
    internalEnv: () => ({}),
    launchContext: async () => {},
    completed() {},
    seedTaskNotes: async () => {},
    reconciled: Promise.resolve(),
  })
  const db = fixture.db
  const rows = async () => db.select().from(terminalRuns)
  const settled = async (count: number) => {
    const deadline = Date.now() + 5000
    while ((await rows()).length < count && Date.now() < deadline) await new Promise((yes) => setTimeout(yes, 20))
    return rows()
  }
  return { ...registrations, glue: terminalRunGlue(), rows, settled }
}

it("records a run target's exit code under its declared name, never its command line", async () => {
  const f = engine()
  const started = Date.now()
  await f.glue.startSession('task-1', { id: 'web', command: 'echo API_KEY=hunter2 >/dev/null; exit 3' }, dir)

  const [row] = await f.settled(1)

  expect(row).toMatchObject({ taskId: 'task-1', kind: 'target', name: 'web', exitCode: 3 })
  expect(row!.startedAt).toBeGreaterThanOrEqual(started)
  expect(row!.finishedAt).toBeGreaterThanOrEqual(row!.startedAt)
  expect(JSON.stringify(row)).not.toMatch(/hunter2|API_KEY|echo/)
})

it('records a run acorn stopped, or whose tab was closed, with no exit code', async () => {
  const f = engine()
  const stopped = await f.glue.startSession('task-1', { id: 'stopped', command: 'sleep 30' }, dir)
  const closed = await f.glue.startSession('task-1', { id: 'closed', command: 'sleep 30' }, dir)

  f.glue.killSession(stopped)
  await f.terminal.remove(closed)

  const rows = await f.settled(2)
  expect(rows.map(({ name, exitCode }) => ({ name, exitCode })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: 'closed', exitCode: null },
    { name: 'stopped', exitCode: null },
  ])
})

it("records the setup script, and not a shell's command", async () => {
  const f = engine('exit 0')
  await f.terminal.create({ taskId: 'task-1', command: 'exit 0' })
  await f.worktreeCreated('task-1', dir)

  const rows = await f.settled(1)
  // Give the shell's exit time to be recorded too, if it were going to be.
  await new Promise((yes) => setTimeout(yes, 200))

  expect(await f.rows()).toEqual(rows)
  expect(rows).toMatchObject([{ kind: 'setup', name: 'Setup', exitCode: 0 }])
})
