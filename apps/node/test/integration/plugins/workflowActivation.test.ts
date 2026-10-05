import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTestNodeContext } from '@acorn/node-core/testkit'
import { schema as coreSchema } from '@acorn/node-core/server/db/index.ts'
import { SCHEDULER, Scheduler } from '@acorn/node-core/server/schedules/index.ts'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import { workflowsPlugin } from '@acorn/plugin-workflows/node/index.ts'
import { AGENTS_SESSION_EXECUTE, type AgentSessionExecute, type AgentSessionExecuteRequest } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { NotesStore } from '@acorn/plugin-notes/testkit'

const WORKFLOW_ROUTE = capabilityId<{
  start(taskId: string, def: unknown, inputs: undefined, allowDatabaseDefinitions: boolean): Promise<{ runId?: string; error?: string }>
  runs(taskId: string): Promise<unknown[]>
  run(runId: string): Promise<{ status: string } | null>
  cancel(runId: string): Promise<{ ok: boolean }>
}>('workflows.route')
const WORKFLOW_DEFS_ROUTE = capabilityId<unknown>('workflows.defs')
const WORKFLOW_SCHEDULES_ROUTE = capabilityId<{ defaults(): { timezone: string } }>('workflows.schedules.route')

registerBuiltInProfiles()

let activePlugin: ReturnType<typeof workflowsPlugin> | null = null
const contexts: ReturnType<typeof makeTestNodeContext>[] = []
const roots: string[] = []
afterEach(() => {
  activePlugin?.dispose?.()
  activePlugin = null
  for (const ctx of contexts.splice(0)) ctx.cleanup()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

it('activates route capabilities and runs managed execution through a late-bound provider', async () => {
  let releaseReconciliation!: () => void
  const reconciled = new Promise<void>(resolve => { releaseReconciliation = resolve })
  const plugin = workflowsPlugin({
    reconciled,
    internalEnv: () => ({ ACORN_API_URL: 'http://127.0.0.1:1', ACORN_API_TOKEN: '' }),
  })
  activePlugin = plugin
  const root = mkdtempSync(join(tmpdir(), 'acorn-workflow-activation-'))
  roots.push(root)
  const ctx = makeTestNodeContext({ plugin, userId: 'owner' })
  contexts.push(ctx)
  const at = Date.now()
  await ctx.db.insert(coreSchema.workspaces).values({
    id: 'workspace', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at,
  })
  await ctx.db.insert(coreSchema.projects).values({
    id: 'project', name: 'Project', path: root, workspaceId: 'workspace', sort: 0,
    hidden: false, vcs: 'none', defaultBranch: 'main', remoteUrl: null, githubOwner: null,
    githubName: null, githubRepoId: null, createdAt: at, updatedAt: at,
  })
  await ctx.db.insert(coreSchema.tasks).values({
    id: 'task', title: 'Task', origin: 'local', projectId: 'project', branch: null,
    worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0,
    createdAt: at, updatedAt: at,
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  ctx.capabilities.provide(SCHEDULER, new Scheduler(ctx.db))
  ctx.capabilities.provide(NOTES_STORE, new NotesStore(join(root, 'notes')))
  await plugin.init?.(ctx)
  const route = ctx.capabilities.get(WORKFLOW_ROUTE)
  expect(route).toBeDefined()
  expect(ctx.capabilities.get(WORKFLOW_DEFS_ROUTE)).toBeDefined()
  expect(ctx.capabilities.get(WORKFLOW_SCHEDULES_ROUTE)?.defaults()).toEqual({ timezone: expect.any(String) })

  const execute = vi.fn(async (_request: AgentSessionExecuteRequest): Promise<NonNullable<Awaited<ReturnType<AgentSessionExecute>>>> => ({
    status: 'ok' as const, exitCode: 0,
    capture: { result: 'done', structuredOutput: null, sessionId: 'managed', costUsd: 0, events: [] },
    stderrTail: '',
  }))
  ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, execute)
  const pendingStart = route!.start('task', {
    baseline: 'acorn-1', formatVersion: 1, name: 'Managed run',
    steps: [{ id: 'agent', name: 'Agent', prompt: 'Do the work.' }],
  }, undefined, false)
  expect(await route!.runs('task')).toHaveLength(0)
  releaseReconciliation()
  const started = await pendingStart
  expect(started.error).toBeUndefined()
  expect(started.runId).toBeDefined()
  await vi.waitFor(async () => expect((await route!.run(started.runId!))?.status).not.toBe('running'))
  expect(await route!.run(started.runId!)).toMatchObject({ status: 'done' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({
    taskId: 'task', profileId: 'claude-code', prompt: 'Do the work.', runId: started.runId,
  }))
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(`/v1/core/tasks/task/context?workflowRunId=${started.runId}`),
    expect.objectContaining({ headers: { 'x-acorn-internal': '' } }),
  )

  // GitHub is absent in this fixture. A checks-green gate must fail closed without a PR/check set.
  const policy = await route!.start('task', {
    baseline: 'acorn-1', formatVersion: 1, name: 'Policy run',
    steps: [{ id: 'checks', name: 'Checks', kind: 'gate-policy', policy: 'checks-green' }],
  }, undefined, false)
  expect(policy.runId).toBeDefined()
  await vi.waitFor(async () => expect((await route!.run(policy.runId!))?.status).toBe('failed'))

  let aborted = false
  execute.mockImplementationOnce(request => new Promise(resolve => {
    request.signal?.addEventListener('abort', () => {
      aborted = true
      resolve({
        status: 'cancelled', exitCode: null,
        capture: { result: null, structuredOutput: null, sessionId: 'managed', costUsd: 0, events: [] },
        stderrTail: '',
      })
    }, { once: true })
  }))
  const pending = await route!.start('task', {
    baseline: 'acorn-1', formatVersion: 1, name: 'Cancelled run',
    steps: [{ id: 'agent', name: 'Agent', prompt: 'Keep working.' }],
  }, undefined, false)
  expect(pending.runId).toBeDefined()
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  await route!.cancel(pending.runId!)
  await vi.waitFor(async () => expect((await route!.run(pending.runId!))?.status).toBe('cancelled'))
  expect(aborted).toBe(true)

  let teardownAborted = false
  execute.mockImplementationOnce(request => new Promise(resolve => {
    request.signal?.addEventListener('abort', () => {
      teardownAborted = true
      resolve({
        status: 'cancelled', exitCode: null,
        capture: { result: null, structuredOutput: null, sessionId: 'managed', costUsd: 0, events: [] },
        stderrTail: '',
      })
    }, { once: true })
  }))
  const teardown = await route!.start('task', {
    baseline: 'acorn-1', formatVersion: 1, name: 'Stopped with plugin',
    steps: [{ id: 'agent', name: 'Agent', prompt: 'Keep working.' }],
  }, undefined, false)
  expect(teardown.runId).toBeDefined()
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
  plugin.dispose?.()
  expect(teardownAborted).toBe(true)
})
