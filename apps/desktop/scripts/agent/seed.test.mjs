import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const run = promisify(execFile)

test.each([
  { mode: 'off', names: ['repo', 'side-project'] },
  { mode: 'on', names: ['Default', 'Side project'] },
])('the navigation fixture gives both hosts tasks in two workspaces with mode $mode', async ({ mode, names }) => {
  const directory = await mkdtemp(join(tmpdir(), 'acorn-tui-fixture-'))
  const dataDir = join(directory, 'data')
  const project = join(directory, 'fixture', 'repo')
  try {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', 'scripts/agent/seed.ts',
      '--data-dir', dataDir, '--project', project, '--fixture', 'tui-navigation',
      '--profile', 'small', '--seed', '1', '--workspaces', mode], {
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
      expect(workspaces).toEqual(names)
    } finally {
      db.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

test.each(['on', 'off'])('repeat seed after owner binding preserves %s mode and one project', async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), 'acorn-agent-reuse-'))
  const dataDir = join(directory, 'data')
  const project = join(directory, 'project')
  const seed = async () => run(process.execPath, ['--import', 'tsx', 'scripts/agent/seed.ts',
    '--data-dir', dataDir, '--project', project, '--workspaces', mode], {
    cwd: resolve(import.meta.dirname, '../..'), maxBuffer: 1024 * 1024,
  })
  try {
    await mkdir(project)
    const first = (await seed()).stdout.trim()
    const db = new DatabaseSync(join(dataDir, 'core.sqlite'))
    try {
      // Node boot adopts preboot preferences into its bound owner before --reuse seeds again.
      db.prepare("update prefs set user_id = 'bound-owner' where user_id = ''").run()
      await writeFile(join(dataDir, 'active-identity'), 'bound-owner\n')
    } finally { db.close() }
    const second = (await seed()).stdout.trim()
    expect(second).toBe(first)
    const saved = new DatabaseSync(join(dataDir, 'core.sqlite'), { readOnly: true })
    try {
      expect(saved.prepare('select id from projects').all()).toHaveLength(1)
      expect(saved.prepare("select user_id, value from prefs where key = 'core.workspaces'").all())
        .toEqual([{ user_id: 'bound-owner', value: mode }])
    } finally { saved.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60_000)
