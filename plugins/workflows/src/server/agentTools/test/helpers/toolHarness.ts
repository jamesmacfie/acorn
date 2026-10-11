// A booted workflows plugin with a fake Agents plugin, for the agent tool tests
// (../../tools.test.ts, ../../launches.test.ts). The tools are called
// through the same registry the MCP route reads, with the context a signed call would carry.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { makeTestNodeContext, schema as coreSchema } from '@acorn/plugin-api/testkit'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import {
  agentProfileRegistry,
  DEFAULT_PROFILE_ID,
  type AgentToolContribution,
  type ToolContext,
} from '@acorn/plugin-api/node'
import { AGENTS_TOOL_CALLER, type AgentSettledTurn } from '@acorn/plugin-agents/contract/toolCaller.ts'
import {
  AGENTS_REQUESTS,
  AGENTS_TURNS,
  type AgentRequestState,
  type AgentTurnState,
} from '@acorn/plugin-agents/contract/lifecycle.ts'
import {
  AGENTS_SESSION_EXECUTE,
  type AgentSessionExecute,
  type AgentSessionExecuteRequest,
} from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { workflowsPlugin } from '../../../../node/index'
import { WORKFLOW_INVOCATION_ROUTE } from '../../../routes/invocationBridge'
import type { WorkflowDef } from '../../../../shared/workflowContracts'

if (!agentProfileRegistry.get(DEFAULT_PROFILE_ID)) {
  agentProfileRegistry.register({
    id: DEFAULT_PROFILE_ID,
    label: 'Fixture',
    kind: 'agent',
    command: 'fixture',
    backendPreference: 'tmux',
    transport: 'pty',
    managedProvider: 'claude',
  })
}

export const workflowDef = (
  name: string,
  steps: WorkflowDef['steps'] = [{ id: 'plan', name: 'Plan', prompt: 'Plan the work.' }],
): WorkflowDef => ({ baseline: ACORN_BASELINE, formatVersion: 1, name, steps })

/** The context a signed managed session's call carries. */
export const managed = (sessionId: string, callId: string): Partial<ToolContext> => ({ sessionId, callId })

type FakeSession = { workflowOwned?: boolean; delegated?: boolean; workflowRunId?: string | null }
type ExecuteResult = NonNullable<Awaited<ReturnType<AgentSessionExecute>>>

export const finishedStep = (structuredOutput: unknown = null): ExecuteResult => ({
  status: 'ok',
  exitCode: 0,
  stderrTail: '',
  capture: { result: 'done', structuredOutput, sessionId: 'managed', costUsd: 0, events: [] },
})

/** Boots the plugin. Pass an earlier boot's root to reopen its database, as a restart would. */
export async function bootWorkflowTools(existingRoot?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), 'acorn-workflow-tools-'))
  const checkout = join(root, 'checkout')
  mkdirSync(join(checkout, '.acorn', 'workflows'), { recursive: true })
  writeFileSync(
    join(checkout, '.acorn', 'workflows', 'review.toml'),
    [
      'format_version = 1',
      `baseline = "${ACORN_BASELINE}"`,
      'name = "Repo review"',
      'trigger = "nightly"',
      '[[inputs]]',
      'name = "ticket_id"',
      `schema_json = '{"type":"string"}'`,
      `default_json = '"ABC-1"'`,
      '[[steps]]',
      'id = "review"',
      'name = "Review"',
      'prompt = "Review ${inputs.ticket_id}"',
    ].join('\n'),
  )
  writeFileSync(join(checkout, '.acorn', 'workflows', 'broken.toml'), 'format_version = 1\nname = "Broken"\n')
  const plugin = workflowsPlugin({
    reconciled: Promise.resolve(),
    internalEnv: () => ({ ACORN_API_URL: 'http://127.0.0.1:1', ACORN_API_TOKEN: '' }),
  })
  const ctx = makeTestNodeContext({ plugin, userId: 'owner', dataDir: join(root, 'data') })

  // The fake Agents plugin: signed managed sessions (a terminal session is absent), their turns, and
  // the questions they ask.
  const sessions = new Map<string, FakeSession>([
    ['session-a', {}],
    ['session-b', {}],
  ])
  const turns = new Map<string, { turnId: string; status: AgentTurnState['status'] }[]>()
  const requests: AgentRequestState[] = []
  const listeners = new Set<(turn: AgentSettledTurn) => void>()
  const activeTurn = (sessionId: string) =>
    turns.get(sessionId)?.find((turn) => ['dispatching', 'active'].includes(turn.status))?.turnId ?? null
  ctx.capabilities.provide(AGENTS_TOOL_CALLER, {
    resolve: async (taskId, sessionId) => {
      const session = taskId === 'task' ? sessions.get(sessionId) : undefined
      return session
        ? {
            taskId,
            sessionId,
            title: `Chat ${sessionId}`,
            workflowOwned: session.workflowOwned ?? false,
            delegated: session.delegated ?? false,
            workflowRunId: session.workflowRunId ?? null,
            activeTurnId: activeTurn(sessionId),
          }
        : null
    },
    onTurnSettled: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  })
  ctx.capabilities.provide(AGENTS_TURNS, {
    list: async ({ sessionId }) =>
      (turns.get(sessionId ?? '') ?? []).map((turn, ordinal) => ({
        taskId: 'task',
        sessionId: sessionId!,
        turnId: turn.turnId,
        status: turn.status,
        source: 'interactive',
        attempt: 0,
        ordinal,
        providerTurnRef: null,
        stopReason: null,
        createdAt: 0,
        startedAt: null,
        completedAt: null,
      })),
  })
  ctx.capabilities.provide(AGENTS_REQUESTS, {
    list: async ({ taskId }) => requests.filter((request) => request.taskId === taskId),
  })
  const execute = vi.fn(async (_request: AgentSessionExecuteRequest) => finishedStep())
  ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, execute)
  // Agent steps write a handoff note when they finish. Nothing here reads it back.
  ctx.capabilities.provide(NOTES_STORE, { append: async () => undefined, setIncluded: async () => undefined } as never)

  const at = Date.now()
  await ctx.db
    .insert(coreSchema.workspaces)
    .values({ id: 'workspace', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
  for (const id of ['project', 'other']) {
    await ctx.db.insert(coreSchema.projects).values({
      id,
      name: id,
      path: id === 'project' ? checkout : join(root, id),
      workspaceId: 'workspace',
      sort: 0,
      hidden: false,
      vcs: 'none',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: null,
      githubName: null,
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
  }
  await ctx.db.insert(coreSchema.tasks).values({
    id: 'task',
    title: 'Task',
    origin: 'local',
    projectId: 'project',
    branch: null,
    worktreePath: null,
    pullNumber: null,
    status: 'active',
    parentId: null,
    sort: 0,
    createdAt: at,
    updatedAt: at,
  })
  // Registration still goes through the host, which removes the tools at cleanup. The list is the
  // same one the MCP route reads.
  const tools: AgentToolContribution[] = []
  await plugin.init?.({
    ...ctx,
    tools: {
      register: (tool) => {
        tools.push(tool)
        ctx.tools.register(tool)
      },
    },
  })
  // The plugin subscribes to settled turns once reconciliation resolves, a tick after init.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const call = async (name: string, input: unknown, context: Partial<ToolContext> = {}) => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (!tool) throw new Error(`${name} is not registered`)
    return tool.handler(tool.input.parse(input), { taskId: 'task', userLogin: 'owner', ...context }) as Promise<
      Record<string, any>
    >
  }
  // A finished run's terminal callbacks still read the database for a moment after its status lands.
  const close = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    plugin.dispose?.()
    ctx.cleanup()
  }
  return {
    call,
    root,
    ctx,
    execute,
    sessions,
    requests,
    tools,
    store: ctx.storage.open(),
    invocation: () => ctx.capabilities.get(WORKFLOW_INVOCATION_ROUTE)!,
    startTurn: (sessionId: string, turnId: string) => {
      turns.set(sessionId, [...(turns.get(sessionId) ?? []), { turnId, status: 'active' }])
    },
    /** Settles a turn the way Agents does: the row first, then the event. */
    settleTurn: (sessionId: string, turnId: string, status: AgentSettledTurn['status']) => {
      const turn = turns.get(sessionId)?.find((candidate) => candidate.turnId === turnId)
      if (turn) turn.status = status
      for (const listener of listeners) listener({ taskId: 'task', sessionId, turnId, status })
    },
    /** Closes this boot and leaves its files, so the next boot reopens the same database. */
    stop: close,
    cleanup: async () => {
      await close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export type WorkflowToolHarness = Awaited<ReturnType<typeof bootWorkflowTools>>
