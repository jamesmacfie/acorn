import { createTaskService } from '@acorn/node-core/server/core/tasks.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { localGitBridge } from '../localGit'
import type { LocalStatus } from '@acorn/protocol/terminal.ts'
import { makeTestDb, schema, type TestDb } from '@acorn/plugin-api/testkit'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { onServerError } from '@acorn/node-core/server/respond.ts'
import { localGit, setLocalGitBridge, type GitActionResult } from './localGit'
import { ProviderOperationError, type GenerateTextRequest } from '@acorn/plugin-api/node'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// Wiring test over a real git worktree: working-tree status, a stage mutation, auth, body validation,
// and bridge-unavailable. ../localDiff.test.ts covers the git parsing.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// The model seam the bridge now takes. Every test in this file is about git, so both members refuse:
// what a real generate does is ../commitMessage.test.ts and the two route tests below.
const noModels = {
  generateText: () => Promise.reject(new Error('no provider in this test')),
  available: () => Promise.resolve([]),
}

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  return app.route('/api/tasks', localGit).onError(onServerError)
}

describe('local-git routes over a real worktree', () => {
  let t: TestDb
  let work: string

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'acorn-localgit-'))
    execFileSync('git', ['init', '-q'], { cwd: work })
    execFileSync('git', ['config', 'user.email', 'test@acorn.dev'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 'Acorn Test'], { cwd: work })
    writeFileSync(join(work, 'new.txt'), 'hello\n', 'utf8')
  })
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  beforeEach(async () => {
    t = makeTestDb()
    setLocalGitBridge(localGitBridge({ tasks: createTaskService(t.db), models: noModels }))
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: work, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', projectId: 'project-widget', branch: 'main',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })
  afterEach(() => {
    setLocalGitBridge(null)
    t.cleanup()
  })

  const statusOf = async (app: ReturnType<typeof authed>) =>
    (await (await app.fetch(req('/api/tasks/task1/local/status'), {} as Env)).json()) as LocalStatus

  it('answers the whole status shape and stages a path out of it', async () => {
    const app = authed()
    const status = await statusOf(app)
    // The branch facts travel with the file list, which is the point of the one read.
    expect(Object.keys(status).sort()).toEqual(['ahead', 'behind', 'branch', 'changes', 'operation', 'upstream'])
    expect(status.changes.find((c) => c.path === 'new.txt')?.status).toBe('untracked')

    const staged = await (await app.fetch(req('/api/tasks/task1/local/stage', 'POST', { paths: ['new.txt'] }), {} as Env)).json()
    expect(staged).toMatchObject({ ok: true })
    expect((await statusOf(app)).changes.find((c) => c.path === 'new.txt')?.staged).toBe(true)
  })

  it('400s an empty path list, the old single-path body, and a diff with no path query', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/local/stage', 'POST', { paths: [] }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/stage', 'POST', { path: 'new.txt' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/unstage', 'POST', { path: 'new.txt' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/stage', 'POST', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/diff'), {} as Env)).status).toBe(400)
  })

  // Each commit flag is strictly a boolean. `'yes'` is a caller bug, and coercing it would amend a
  // commit nobody asked to amend.
  it('400s a commit whose flags are not booleans, or whose body has no message', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/local/commit', 'POST', { message: 'x', amend: 'yes' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/commit', 'POST', { message: 'x', all: 1 }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/commit', 'POST', { amend: true }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/commit', 'POST', 'not json at all'), {} as Env)).status).toBe(400)
  })

  // The two remote bodies. `'yes'` coerced would turn a fast-forward pull into a rebase, or an
  // ordinary push into one that replaces a commit on the remote.
  it('400s a pull or a push whose flag is not a boolean, and passes a real one through', async () => {
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/local/pull', 'POST', { rebase: 'yes' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/push', 'POST', { force: 'yes' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/push', 'POST', { force: 1 }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/local/pull', 'POST', 'not json at all'), {} as Env)).status).toBe(400)

    // No origin in this fixture, so the pull fails in git rather than in the parser — which is the
    // proof the flag reached the bridge.
    const pulled = await (await app.fetch(req('/api/tasks/task1/local/pull', 'POST', { rebase: true }), {} as Env)).json() as GitActionResult
    expect(pulled.ok).toBe(false)
    expect(pulled.reason).toBeTruthy()
  })

  // Abort takes no body and reads the operation off the tree, so a request that arrives when nothing
  // is in flight is refused rather than guessed at.
  it('refuses an abort when no merge or rebase is in progress', async () => {
    const app = authed()
    expect(await (await app.fetch(req('/api/tasks/task1/local/abort', 'POST'), {} as Env)).json())
      .toEqual({ ok: false, reason: 'No merge or rebase is in progress.' })
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', localGit)
    expect((await gated.fetch(req('/api/tasks/task1/local/status'), {} as Env)).status).toBe(401)
    setLocalGitBridge(null)
    expect((await authed().fetch(req('/api/tasks/task1/local/status'), {} as Env)).status).toBe(503)
  })
})

// The two hook chains, from the owner's side: the bridge is what runs them, so this is where the
// payload each hands over is pinned. ../../node/index.ts declares the points; ../localGit.ts
// § CHANGES_HOOKS spells the payloads beside the calls.
describe('the hook chains, as the bridge runs them', () => {
  let t: TestDb
  let work: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8' })
  const seen: Record<string, unknown>[] = []

  // What a handler answered, set per test. A transform returns the payload as it left the chain,
  // which is the one thing the owner acts on (docs/plugins.md § Hooks).
  let verdict: { ok: boolean; reason?: string; by?: string; transform?: (message: string) => string } = { ok: true }
  const hooks = {
    run: async <T extends Record<string, unknown>>(id: string, payload: T) => {
      seen.push({ id, ...payload })
      const message = verdict.transform ? verdict.transform(String(payload.message)) : payload.message
      return { ok: verdict.ok, reason: verdict.reason, by: verdict.by, payload: { ...payload, message } as T }
    },
  }

  beforeEach(async () => {
    seen.length = 0
    verdict = { ok: true }
    work = mkdtempSync(join(tmpdir(), 'acorn-hooked-'))
    git('init', '-q')
    git('config', 'user.email', 'test@acorn.dev')
    git('config', 'user.name', 'Acorn Test')
    writeFileSync(join(work, 'a.txt'), 'one\n', 'utf8')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'first')

    t = makeTestDb()
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: work, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', projectId: 'project-widget', branch: 'main',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })
  afterEach(() => {
    t.cleanup()
    rmSync(work, { recursive: true, force: true })
  })

  const bridge = () => localGitBridge({ tasks: createTaskService(t.db), models: noModels }, () => {}, hooks)

  it('hands a handler the amend flag, and commits the message the chain left', { timeout: 15_000 }, async () => {
    verdict = { ok: true, transform: (message) => `lint: ${message}` }
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')

    expect(await bridge().commit('task1', 'plain subject', { all: true })).toEqual({ ok: true })
    expect(seen).toEqual([{ id: 'before-commit', taskId: 'task1', branch: 'main', message: 'plain subject', amend: false }])
    // The transform, not the original: one value for the owner to act on either way.
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('lint: plain subject')

    seen.length = 0
    expect(await bridge().commit('task1', 'reworded', { amend: true })).toEqual({ ok: true })
    expect(seen[0]).toMatchObject({ amend: true })
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('lint: reworded')
    // An amend, so the branch is still two commits long.
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('2')
  })

  it('turns a veto into a reason with the objecting plugin in front of it, and commits nothing', async () => {
    verdict = { ok: false, reason: 'subject too long', by: 'commit-lint' }
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')

    expect(await bridge().commit('task1', 'a subject', { all: true }))
      .toEqual({ ok: false, reason: 'commit-lint: subject too long' })
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('first')
  })

  it('answers HEAD\'s message for the field an amend fills, and null where there is no worktree', async () => {
    expect(await bridge().headCommit('task1')).toMatchObject({ message: 'first' })
    expect(await bridge().headCommit('nobody')).toBeNull()
  })

  // `force` is the field a branch-protection handler exists to read. Payload matching is exact, so it
  // is on every push whether or not the reader asked for one (docs/plugins.md § Hooks).
  it('hands a handler the force flag on both kinds of push', { timeout: 15_000 }, async () => {
    // No origin in this fixture, so both pushes fail in git. What is under test is what the chain
    // saw before that.
    await bridge().push('task1')
    expect(seen).toEqual([{ id: 'before-push', taskId: 'task1', branch: 'main', force: false }])

    seen.length = 0
    await bridge().push('task1', { force: true })
    expect(seen).toEqual([{ id: 'before-push', taskId: 'task1', branch: 'main', force: true }])
  })

  it('turns a force-push veto into a reason with the objecting plugin in front of it', async () => {
    verdict = { ok: false, reason: 'main is protected', by: 'branch-guard' }
    expect(await bridge().push('task1', { force: true }))
      .toEqual({ ok: false, reason: 'branch-guard: main is protected' })
    // Vetoed before git ran, so nothing was attempted against a remote that does not exist.
    expect(seen).toEqual([{ id: 'before-push', taskId: 'task1', branch: 'main', force: true }])
  })
})

// The two model routes: the owner gate, the bodies, and how a provider's refusal reaches the reader.
// A real bridge over a real worktree with a stub model seam, so what is under test is the whole path
// down to the prompt — ../commitMessage.test.ts pins what the prompt says.
describe('the generated commit message', () => {
  let t: TestDb
  let work: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8' })

  // What the stub provider did and what it will answer. `fail` is thrown rather than returned,
  // because that is how `core.models.generateText` reports a refusal.
  let asked: GenerateTextRequest | null = null
  let answer = 'feat: something\n\nAnd why.'
  let fail: unknown = null
  const models = {
    generateText: (request: GenerateTextRequest) => {
      asked = request
      if (fail) return Promise.reject(fail)
      return Promise.resolve({ text: answer, providerId: 'anthropic', backendId: request.backendId, modelId: 'a-model' })
    },
    available: () => Promise.resolve([
      { id: 'connection:conn-1', kind: 'connection', label: 'Work key', models: [], defaultModelId: '' },
    ] satisfies ModelBackend[]),
  }

  // An agent's credential: an internal token bound to one task. It may drive that task's tools and it
  // may not spend the owner's provider key (docs/security.md § Credential handling).
  const asAgent = () => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
      await next()
    })
    return app.route('/api/tasks', localGit).onError(onServerError)
  }

  beforeEach(async () => {
    asked = null
    answer = 'feat: something\n\nAnd why.'
    fail = null
    work = mkdtempSync(join(tmpdir(), 'acorn-generate-'))
    git('init', '-q', '-b', 'james/fix-the-header')
    git('config', 'user.email', 'test@acorn.dev')
    git('config', 'user.name', 'Acorn Test')
    writeFileSync(join(work, 'a.txt'), 'one\n', 'utf8')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'first')

    t = makeTestDb()
    setLocalGitBridge(localGitBridge({ tasks: createTaskService(t.db), models }))
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: work, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({
      id: 'task1', title: 'T', origin: 'local', projectId: 'project-widget', branch: 'james/fix-the-header',
      worktreePath: work, pullNumber: null, status: 'active', sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })
  afterEach(() => {
    setLocalGitBridge(null)
    t.cleanup()
    rmSync(work, { recursive: true, force: true })
  })

  const generate = (app: ReturnType<typeof authed>, body: unknown) =>
    app.fetch(req('/api/tasks/task1/local/commit-message', 'POST', body), {} as Env)

  it('writes a message from the staged diff and says which model wrote it', async () => {
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')
    git('add', 'a.txt')

    const response = await generate(authed(), { backendId: 'conn-1', modelId: 'a-model' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'feat: something\n\nAnd why.', providerId: 'anthropic', modelId: 'a-model' })
    // The prompt is built on the node from the diff the next commit would take, so the branch and the
    // patch are both in it and the client sent neither.
    expect(asked!.input.prompt).toContain('Branch: james/fix-the-header')
    expect(asked!.input.prompt).toContain('Committing what is in the index.')
    expect(asked!.input.prompt).toContain('+two')
    expect(asked!.userId).toBe('james')
  })

  it('describes every tracked change when nothing is staged', async () => {
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')
    expect((await generate(authed(), { backendId: 'conn-1' })).status).toBe(200)
    expect(asked!.input.prompt).toContain('Nothing is staged')
    // No model asked for, so none is passed on and the provider runtime picks.
    expect(asked!.input.modelId).toBeUndefined()
  })

  it('refuses a clean tree before it spends anything', async () => {
    const response = await generate(authed(), { backendId: 'conn-1' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'nothing_to_commit' } })
    expect(asked).toBe(null)
  })

  it('400s a body with no connection in it', async () => {
    const app = authed()
    expect((await generate(app, {})).status).toBe(400)
    expect((await generate(app, { backendId: '' })).status).toBe(400)
    expect((await generate(app, { backendId: 'conn-1', modelId: 7 })).status).toBe(400)
    expect((await generate(app, 'not json at all')).status).toBe(400)
  })

  // An automation caller has no editor to put the text in and no business paying for one.
  it('403s an agent credential on both routes', async () => {
    const app = asAgent()
    expect((await app.fetch(req('/api/tasks/task1/local/commit-message', 'POST', { backendId: 'conn-1' }), {} as Env)).status).toBe(403)
    expect((await app.fetch(req('/api/tasks/task1/local/model-connections'), {} as Env)).status).toBe(403)
  })

  it('answers the backends this owner could generate with, ids and labels only', async () => {
    const response = await authed().fetch(req('/api/tasks/task1/local/model-connections'), {} as Env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { id: 'connection:conn-1', kind: 'connection', label: 'Work key', models: [], defaultModelId: '' },
    ])
  })

  // The status the reader has to act on: 401 means reconnect the key, 429 means wait. `viaBridge`
  // would have turned both into a 500.
  it('maps a provider refusal to its own status and code', async () => {
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')
    fail = new ProviderOperationError('provider_needs_auth', 401)
    const denied = await generate(authed(), { backendId: 'conn-1' })
    expect(denied.status).toBe(401)
    expect(await denied.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })

    fail = new ProviderOperationError('provider_rate_limited', 429)
    expect((await generate(authed(), { backendId: 'conn-1' })).status).toBe(429)

    // Anything else is flattened, as core does for its own provider calls: an upstream exception
    // message can quote a URL or a response body.
    fail = new Error('https://api.example.test failed with sk-abc')
    const flattened = await generate(authed(), { backendId: 'conn-1' })
    expect(flattened.status).toBe(502)
    expect(await flattened.text()).not.toContain('sk-abc')
  })

  it('unwraps a fenced answer, so nothing has to be edited out of the field', async () => {
    writeFileSync(join(work, 'a.txt'), 'two\n', 'utf8')
    answer = '```\nfix: the header\n```'
    const response = await generate(authed(), { backendId: 'conn-1' })
    expect(await response.json()).toMatchObject({ message: 'fix: the header' })
  })

  it('503s without a bridge', async () => {
    setLocalGitBridge(null)
    expect((await authed().fetch(req('/api/tasks/task1/local/model-connections'), {} as Env)).status).toBe(503)
  })
})
