import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { makeTestCoreServices, makeTestDb, onServerError, schema, type AppEnv } from '@acorn/plugin-api/testkit'
import { localGitBridge } from './localGit'
import { localGit, setLocalGitBridge } from './routes/localGit'

let directory = ''
afterEach(() => {
  setLocalGitBridge(null)
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'acorn-pull-admission-'))
  const root = join(directory, 'repo'),
    bare = join(directory, 'remote.git')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'file'), 'root\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  git(directory, 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'remote', 'add', 'origin', bare)
  git(root, 'push', '-qu', 'origin', 'main')
  const db = makeTestDb(),
    at = Date.now()
  await db.db
    .insert(schema.workspaces)
    .values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
  await db.db.insert(schema.projects).values({
    id: 'project',
    name: 'Project',
    path: root,
    workspaceId: 'ws',
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: at,
    updatedAt: at,
  })
  await db.db.insert(schema.tasks).values({
    id: 'task',
    title: 'Task',
    origin: 'local',
    projectId: 'project',
    branch: 'main',
    worktreePath: root,
    pullNumber: null,
    status: 'active',
    sort: 0,
    createdAt: at,
    updatedAt: at,
  })
  const core = makeTestCoreServices(db)
  let turn = false,
    run = false
  core.checkoutAdmission.registerOwner('turns', async () =>
    turn ? [{ taskId: 'task', description: 'queued turn' }] : [],
  )
  core.checkoutAdmission.registerOwner('runs', async () =>
    run ? [{ taskId: 'task', description: 'workflow run' }] : [],
  )
  const bridge = localGitBridge(core)
  return {
    root,
    db,
    core,
    bridge,
    busyTurn: (value: boolean) => {
      turn = value
    },
    busyRun: (value: boolean) => {
      run = value
    },
  }
}

it('guards Changes pull for queued work, dirty or unresolved checkout, and changed task mapping', async () => {
  const state = await fixture()
  try {
    state.busyTurn(true)
    expect((await state.bridge.pull('task')).reason).toContain('queued turn')
    state.busyTurn(false)
    state.busyRun(true)
    expect((await state.bridge.pull('task')).reason).toContain('workflow run')
    state.busyRun(false)
    state.db.db
      .update(schema.projects)
      .set({ setupScript: 'echo setup' })
      .where(eq(schema.projects.id, 'project'))
      .run()
    state.db.db
      .insert(schema.taskScriptAttempts)
      .values({
        attemptId: 'skipped-setup',
        taskId: 'task',
        phase: 'setup',
        generation: 1,
        state: 'skipped',
        reason: 'user_skipped',
        requestedAt: Date.now(),
        finishedAt: Date.now(),
      })
      .run()
    const setup = await state.core.taskScripts.admitManualSetup('task')
    expect((await state.bridge.pull('task')).reason).toContain('setup starting')
    state.core.taskScripts.report(
      { attemptId: setup.attemptId!, generation: setup.generation },
      { type: 'exit', exitCode: 0 },
    )
    writeFileSync(join(state.root, 'file'), 'dirty\n')
    expect((await state.bridge.pull('task')).reason).toContain('local changes')
    git(state.root, 'checkout', '--', 'file')
    writeFileSync(join(state.root, '.git', 'MERGE_HEAD'), `${git(state.root, 'rev-parse', 'HEAD')}\n`)
    expect((await state.bridge.pull('task')).reason).toContain('current operation')
    rmSync(join(state.root, '.git', 'MERGE_HEAD'))
    state.db.db.update(schema.tasks).set({ branch: 'another' }).where(eq(schema.tasks.id, 'task')).run()
    expect((await state.bridge.pull('task')).reason).toContain('Task branch changed')
    state.db.db
      .update(schema.tasks)
      .set({ status: 'archived', archivedAt: Date.now() })
      .where(eq(schema.tasks.id, 'task'))
      .run()
    expect((await state.bridge.pull('task')).ok).toBe(false)
  } finally {
    state.db.cleanup()
  }
})

it('uses the same guarded pull through the bridge and public route, with both strategies', async () => {
  const state = await fixture()
  try {
    expect(await state.bridge.pull('task', { rebase: false })).toEqual({ ok: true })
    setLocalGitBridge(state.bridge)
    const app = new Hono<AppEnv>()
      .use('/api/*', async (c, next) => {
        c.set('principal', { kind: 'device', userId: 'owner' })
        await next()
      })
      .route('/api/tasks', localGit)
      .onError(onServerError)
    const response = await app.fetch(
      new Request('http://acorn.test/api/tasks/task/local/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rebase: true }),
      }),
      {} as never,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  } finally {
    state.db.cleanup()
  }
})

it('keeps the observed force lease through the Changes route after tracking advances', async () => {
  const state = await fixture()
  try {
    const observed = (await state.bridge.status('task')).upstreamId!
    const other = join(directory, 'other')
    git(directory, 'clone', '-q', join(directory, 'remote.git'), other)
    git(other, 'config', 'user.name', 'Other Actor')
    git(other, 'config', 'user.email', 'other@acorn.dev')
    writeFileSync(join(other, 'other'), 'advanced\n')
    git(other, 'add', '.')
    git(other, 'commit', '-qm', 'Advance')
    git(other, 'push', '-q', 'origin', 'main')
    writeFileSync(join(state.root, 'file'), 'local rewrite\n')
    git(state.root, 'commit', '-qam', 'Local rewrite')
    expect(await state.bridge.fetch('task')).toMatchObject({ ok: true })
    expect((await state.bridge.status('task')).upstreamId).not.toBe(observed)
    setLocalGitBridge(state.bridge)
    const app = new Hono<AppEnv>()
      .use('/api/*', async (c, next) => {
        c.set('principal', { kind: 'device', userId: 'owner' })
        await next()
      })
      .route('/api/tasks', localGit)
      .onError(onServerError)
    const response = await app.fetch(
      new Request('http://acorn.test/api/tasks/task/local/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true, expectedBranch: 'main', expectedRemoteId: observed }),
      }),
      {} as never,
    )
    expect(await response.json()).toMatchObject({ ok: false, reason: expect.stringMatching(/stale info|rejected/i) })
    expect(git(state.root, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(
      git(other, 'rev-parse', 'HEAD'),
    )
  } finally {
    state.db.cleanup()
  }
})

it('refuses a pull whose task checkout mapping changes before admission', async () => {
  const state = await fixture()
  try {
    const moved = join(directory, 'moved')
    git(directory, 'clone', '-q', state.root, moved)
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const bridge = localGitBridge({
      ...state.core,
      tasks: {
        ...state.core.tasks,
        root: async () => {
          entered()
          await resume
          return state.root
        },
      },
    })
    const pull = bridge.pull('task', { rebase: false })
    await started
    state.db.db.update(schema.tasks).set({ worktreePath: moved }).where(eq(schema.tasks.id, 'task')).run()
    release()
    expect((await pull).reason).toContain('Target checkout moved')
  } finally {
    state.db.cleanup()
  }
})
