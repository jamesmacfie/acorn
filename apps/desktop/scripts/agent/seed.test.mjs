import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const run = promisify(execFile)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

test('the navigation fixture gives both hosts tasks in two workspaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acorn-tui-fixture-'))
  const dataDir = join(directory, 'data')
  const project = join(directory, 'fixture', 'repo')
  try {
    const { stdout } = await run(pnpm, ['exec', 'node', '--import', 'tsx', 'scripts/agent/seed.ts',
      '--data-dir', dataDir, '--project', project, '--fixture', 'tui-navigation',
      '--profile', 'small', '--seed', '1'], {
      cwd: resolve(import.meta.dirname, '../..'),
      maxBuffer: 1024 * 1024,
    })
    const fixture = JSON.parse(stdout.trim().split('\n').at(-1))
    expect(fixture.fixture).toBe('tui-navigation')
    expect([fixture.taskId, fixture.otherTaskId, fixture.otherWorkspaceTaskId]).toEqual([
      expect.any(String), expect.any(String), expect.any(String),
    ])
    const db = new DatabaseSync(join(dataDir, 'core.sqlite'), { readOnly: true })
    try {
      const tasks = db.prepare('select title from tasks order by sort').all().map((row) => row.title)
      expect(tasks).toEqual(['Review changed files', 'Plan follow-up work', 'Check workspace switch'])
      const workspaces = db.prepare('select name from workspaces order by sort').all().map((row) => row.name)
      expect(workspaces).toEqual(['Default', 'Side project'])
    } finally {
      db.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
