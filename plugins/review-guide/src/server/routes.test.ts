import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { StepHandlerContext } from '@acorn/plugin-workflows/contract/extensions.ts'
import type {
  AgentSessionExecuteRequest,
  AgentSessionExecuteResult,
} from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { reviewGuides } from '../node/schema'
import type { GuideView } from '../shared/guide'
import { createGuides, type GuideDeps, type Guides } from './guides'
import { createGuideFetch } from './routes'
import { guideStepHandler } from './workflowStep'

// A worktree whose branch adds one file and changes another against origin/main.
function makeWorktree(): { dir: string; commit(): string } {
  const dir = mkdtempSync(join(tmpdir(), 'review-guide-'))
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const origin = join(dir, 'origin')
  run(dir, 'init', '-q', '-b', 'main', origin)
  run(origin, 'config', 'user.email', 't@example.com')
  run(origin, 'config', 'user.name', 'T')
  writeFileSync(join(origin, 'app.ts'), 'export const a = 1\n')
  run(origin, 'add', '-A')
  run(origin, 'commit', '-qm', 'base')
  const work = join(dir, 'work')
  run(dir, 'clone', '-q', origin, work)
  run(work, 'config', 'user.email', 't@example.com')
  run(work, 'config', 'user.name', 'T')
  run(work, 'checkout', '-qb', 'feature')
  writeFileSync(join(work, 'app.ts'), 'export const a = 2\n')
  writeFileSync(join(work, 'app.test.ts'), "import { a } from './app'\n")
  run(work, 'add', '-A')
  run(work, 'commit', '-qm', 'change')
  return {
    dir,
    commit: () => {
      writeFileSync(join(work, 'more.ts'), 'export {}\n')
      run(work, 'add', '-A')
      run(work, 'commit', '-qm', 'more')
      return run(work, 'rev-parse', 'HEAD')
    },
  }
}

const git: GuideDeps['git'] = {
  git: async (args, { cwd }) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    return {
      code: result.status,
      signal: null,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
      aborted: false,
      truncated: false,
      spawnError: null,
    }
  },
}

const note = (line: number, text: string) => ({
  hunk: 'app.ts#1',
  side: 'new',
  line,
  text,
  tone: 'attention',
  title: 'Callers read a.',
  body: 'Check them.',
})

const ANSWER = {
  summary: 'Bumps a.',
  steps: [
    {
      title: 'The bump',
      goal: 'what a is now.',
      why: 'Because.',
      kind: 'core',
      hunks: ['app.ts#1'],
      // The first is misnumbered and moves to line 1. The second quotes no line and is dropped.
      notes: [note(7, 'export const a = 2'), note(1, 'export const a = 3')],
    },
    {
      title: 'Its test',
      goal: 'that a is read.',
      why: 'To check it.',
      kind: 'supporting',
      hunks: ['nope.ts#1'],
      notes: [],
    },
  ],
}

const okResult = (structuredOutput: unknown): AgentSessionExecuteResult => ({
  status: 'ok',
  exitCode: 0,
  capture: { result: null, structuredOutput, sessionId: null, costUsd: null, events: [] },
  stderrTail: '',
  agentSessionId: 'session-1',
})

describe('review guide routes', () => {
  let repo: ReturnType<typeof makeWorktree>
  let pluginDb: TestPluginDb
  let guides: Guides
  let fetch: ReturnType<typeof createGuideFetch>
  let turns: { request: AgentSessionExecuteRequest; finish(result: AgentSessionExecuteResult): void }[]
  let changed: ReturnType<typeof vi.fn<(taskId: string) => void>>
  const prefs = new Map<string, string>()

  beforeEach(() => {
    repo = makeWorktree()
    pluginDb = makeTestPluginDb('review-guide')
    turns = []
    changed = vi.fn<(taskId: string) => void>()
    prefs.clear()
    guides = createGuides({
      db: pluginDb.db,
      tasks: {
        root: async (taskId) => (taskId === 'task-1' ? join(repo.dir, 'work') : null),
        changeRequests: async (taskId) =>
          taskId === 'task-1'
            ? [
                {
                  taskId,
                  provider: 'github',
                  host: 'github.com',
                  path: 'acme/app',
                  number: 7,
                  role: 'primary',
                  provenance: 'task',
                },
              ]
            : [],
        changeRequestDetail: async (taskId) =>
          taskId === 'task-1' ? { number: 7, title: 'Bump', body: null, changedFiles: [], baseRef: 'main' } : null,
      },
      git,
      prefs: {
        read: async (_user, key) => prefs.get(key) ?? null,
        write: async (_user, key, value) => void prefs.set(key, value),
      },
      changed,
      execute: () => (request) =>
        new Promise((resolve) => {
          request.onEvent?.({ type: 'managed-agent', sessionId: 'session-1' })
          request.signal?.addEventListener('abort', () =>
            resolve({ ...okResult(null), status: 'cancelled', stderrTail: '' }),
          )
          turns.push({ request, finish: resolve })
        }),
      profiles: () => ({
        list: async () => [
          { id: 'claude-code', label: 'Claude Code' },
          { id: 'codex', label: 'Codex' },
        ],
      }),
    })
    fetch = createGuideFetch(guides)
  })

  afterEach(() => {
    pluginDb.cleanup()
    rmSync(repo.dir, { recursive: true, force: true })
  })

  const call = async (method: 'GET' | 'POST', path: string, body?: object, taskId?: string) => {
    const response = await fetch(
      new Request(`http://plugin${path}`, {
        method,
        ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
      }),
      {
        userId: 'alice',
        principal: taskId
          ? { kind: 'internal', userId: 'alice', scope: 'task', taskId }
          : { kind: 'device', userId: 'alice' },
      } as Parameters<typeof fetch>[1],
    )
    return { status: response.status, body: (await response.json()) as GuideView & { error?: { message: string } } }
  }
  const settled = async () => {
    await vi.waitFor(async () =>
      expect((await call('GET', '/guide?taskId=task-1')).body.guide?.status).not.toBe('generating'),
    )
    return (await call('GET', '/guide?taskId=task-1')).body
  }

  it('offers the profiles and shows an empty state for a task with no change request', async () => {
    const { body } = await call('GET', '/guide?taskId=task-2')
    expect(body).toMatchObject({ hasChangeRequest: false, profileId: 'claude-code', guide: null })
    expect((await call('POST', '/guide/generate', { taskId: 'task-2' })).status).toBe(409)
    expect(turns).toHaveLength(0)
  })

  it('runs one generation at a time and stores the checked guide', async () => {
    const first = await call('POST', '/guide/generate', { taskId: 'task-1', profileId: 'codex' })
    expect(first.body.guide).toMatchObject({ status: 'generating', profileId: 'codex', baseRef: 'main' })
    const second = await call('POST', '/guide/generate', { taskId: 'task-1' })
    expect(second.body.guide?.status).toBe('generating')
    expect(turns).toHaveLength(1)
    expect(turns[0]!.request).toMatchObject({
      taskId: 'task-1',
      profileId: 'codex',
      title: 'Review guide',
      tools: { maxRisk: 'read' },
    })
    expect(turns[0]!.request.context?.[0]?.content).toContain('### app.test.ts#1')

    turns[0]!.finish(okResult(ANSWER))
    const view = await settled()
    expect(view.profileId).toBe('codex')
    expect(view.guide).toMatchObject({ status: 'ready', sessionId: 'session-1' })
    expect(view.guide?.guide).toMatchObject({ summary: 'Bumps a.', repeated: 0, unknown: 1, misplacedNotes: 1 })
    expect(view.guide?.guide?.steps).toMatchObject([
      { title: 'The bump', goal: 'what a is now.', notes: [{ line: 1, text: 'export const a = 2' }] },
    ])
    expect(view.guide?.guide?.steps[0]!.notes).toHaveLength(1)
    expect(view.guide?.guide?.uncovered.map((item) => item.id)).toEqual(['app.test.ts#1'])
    expect(changed).toHaveBeenCalledWith('task-1')
  })

  it('reads a guide stored with sections as steps with no goals or notes', async () => {
    const guide = {
      summary: 'Old.',
      sections: [{ title: 'Core', why: 'Because.', kind: 'core', items: [] }],
      uncovered: [],
      repeated: 0,
      unknown: 0,
    }
    await pluginDb.db.insert(reviewGuides).values({
      taskId: 'task-1',
      baseSha: 'b',
      headSha: 'h',
      baseRef: 'main',
      profileId: 'codex',
      status: 'ready',
      guide: JSON.stringify(guide),
      createdAt: 1,
      updatedAt: 1,
    })
    expect((await call('GET', '/guide?taskId=task-1')).body.guide?.guide).toEqual({
      summary: 'Old.',
      steps: [{ title: 'Core', goal: '', why: 'Because.', kind: 'core', items: [], notes: [] }],
      uncovered: [],
      repeated: 0,
      unknown: 0,
      misplacedNotes: 0,
    })
  })

  it('marks a guide stale when HEAD moves, and leaves it when it does not', async () => {
    await call('POST', '/guide/generate', { taskId: 'task-1' })
    turns[0]!.finish(okResult(ANSWER))
    const ready = await settled()
    await guides.markStale('task-1', ready.guide!.headSha)
    expect((await call('GET', '/guide?taskId=task-1')).body.guide?.status).toBe('ready')
    await guides.markStale('task-1', repo.commit())
    expect((await call('GET', '/guide?taskId=task-1')).body.guide?.status).toBe('stale')
  })

  it('marks a running guide stale when it finishes after HEAD moved', async () => {
    await call('POST', '/guide/generate', { taskId: 'task-1' })
    await guides.markStale('task-1', repo.commit())
    turns[0]!.finish(okResult(ANSWER))
    expect((await settled()).guide?.status).toBe('stale')
  })

  it('stops a running turn', async () => {
    await call('POST', '/guide/generate', { taskId: 'task-1' })
    await call('POST', '/guide/stop', { taskId: 'task-1' })
    expect((await settled()).guide).toMatchObject({ status: 'failed', error: 'You stopped the guide.' })
  })

  it('records a failed turn, and a new request runs again', async () => {
    await call('POST', '/guide/generate', { taskId: 'task-1' })
    turns[0]!.finish({ ...okResult(null), status: 'error', stderrTail: 'The harness crashed.' })
    expect((await settled()).guide).toMatchObject({ status: 'failed', error: 'The harness crashed.' })
    await call('POST', '/guide/generate', { taskId: 'task-1' })
    expect(turns).toHaveLength(2)
  })

  it("holds a task's own caller to its task", async () => {
    expect((await call('GET', '/guide?taskId=task-1', undefined, 'task-9')).status).toBe(404)
    expect((await call('POST', '/guide/generate', { taskId: 'task-1' }, 'task-9')).status).toBe(404)
    expect((await call('GET', '/guide?taskId=task-1', undefined, 'task-1')).status).toBe(200)
  })

  describe('the review-guide:generate step', () => {
    const step = (taskId: string, withTable: Record<string, unknown> = {}, signal = new AbortController().signal) =>
      guideStepHandler(
        guides,
        () => 'alice',
      )({
        run: { id: 'run-1', taskId },
        def: { name: 'guide', kind: 'review-guide:generate', with: withTable },
        signal,
        emit: () => {},
      } as unknown as StepHandlerContext)
    const started = () => vi.waitFor(() => expect(turns.length).toBeGreaterThan(0))

    it('lists the harnesses as select options', async () => {
      const response = await fetch(new Request('http://plugin/profiles'), {
        userId: 'alice',
        principal: { kind: 'device', userId: 'alice' },
      } as Parameters<typeof fetch>[1])
      expect(await response.json()).toEqual({
        options: [
          { value: 'claude-code', label: 'Claude Code' },
          { value: 'codex', label: 'Codex' },
        ],
      })
    })

    it('generates the guide the pane shows, and hands on its text and cost', async () => {
      const outcome = step('task-1', { profileId: 'codex' })
      await started()
      expect(turns[0]!.request).toMatchObject({ profileId: 'codex', tools: { maxRisk: 'read' } })
      const result = okResult(ANSWER)
      result.capture = { ...result.capture, costUsd: 0.42, usage: { inputTokens: 10, outputTokens: 5 } }
      turns[0]!.finish(result)
      expect(await outcome).toEqual({
        status: 'done',
        result: { result: 'Bumps a.\n\n- The bump' },
        costUsd: 0.42,
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      expect((await call('GET', '/guide?taskId=task-1')).body.guide).toMatchObject({
        status: 'ready',
        profileId: 'codex',
      })
      // The pane's pick is the person's choice. A workflow's isn't.
      expect(prefs.has('profile')).toBe(false)
    })

    it('waits for a guide that is already generating instead of starting another', async () => {
      await call('POST', '/guide/generate', { taskId: 'task-1' })
      const outcome = step('task-1')
      await Promise.resolve()
      expect(turns).toHaveLength(1)
      turns[0]!.finish(okResult(ANSWER))
      expect(await outcome).toMatchObject({ status: 'done', result: { result: 'Bumps a.\n\n- The bump' } })
      expect(turns).toHaveLength(1)
    })

    it('fails with the sentence the pane shows', async () => {
      expect(await step('task-2')).toEqual({
        status: 'failed',
        error: "This task has no change request, or its code host didn't answer.",
      })
      const outcome = step('task-1')
      await started()
      turns[0]!.finish({ ...okResult(null), status: 'error', stderrTail: 'The harness crashed.' })
      expect(await outcome).toMatchObject({ status: 'failed', error: 'The harness crashed.' })
    })

    it('stops the turn when the step is stopped', async () => {
      const controller = new AbortController()
      const outcome = step('task-1', {}, controller.signal)
      await started()
      controller.abort()
      expect(await outcome).toMatchObject({ status: 'failed', error: 'You stopped the guide.' })
      expect((await call('GET', '/guide?taskId=task-1')).body.guide?.status).toBe('failed')
    })
  })
})
