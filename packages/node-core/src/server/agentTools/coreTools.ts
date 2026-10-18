import { taskScriptWaitInputSchema, taskScriptLogsInputSchema } from '@acorn/protocol/taskScripts.ts'
import { taskScripts } from '../taskScripts/service'
import { z } from 'zod'
import { changeRequestChecks, changeRequestCreated, changeRequestFeedback } from '@acorn/protocol/plugin/contract.ts'
import { assembleContext, changeRequestSection, parseInclude, registerContextSection } from './contextSections.ts'
import { pluginAuthoringTool } from './pluginAuthoringContribution.ts'
import { pluginRequestTool } from './pluginRequests.ts'
import { RUN_SCRIPT_TOOL } from './callTool.ts'
import {
  registerAgentTool,
  removeAgentTools,
  ToolError,
  type AgentToolContribution,
  type ToolContext,
} from './registry.ts'
import { issueDetailTool } from './issueDetail.ts'
import { issueCommentTool, issueImageTool } from './issueTools.ts'
import type { AppDatabase } from '../db/index.ts'
import { askChangeRequestHost, primaryChangeRequestHost, readChangeRequest } from '../core/changeRequests.ts'
import { createTaskService } from '../core/tasks.ts'
import { changeRequestDeclaration } from '../pluginHost/codeHosts.ts'
import type { Disposable } from '../pluginHost/capabilities.ts'
import type { SecretService } from '../core/secrets.ts'
import type { Env } from '../bindings.ts'
import { discoverDataSources, invokeDataSource, listDataSources } from '../dataSources/runtime.ts'
import { broadcastPluginApprovalNotice, broadcastStatus } from '../notify.ts'
import { githubFacet, projectRepository } from '../projects/projects.ts'
import { loadTask, projectForTask } from '../worktrees/taskWorktree.ts'
import { datasetWriteSchema } from '@acorn/protocol/datasets.ts'

// The owner id for the core-owned contributions. Registration is idempotent across service boots.
const OWNER = 'core'

export type AgentToolsDeps = {
  db: AppDatabase
  // Only the issue tools need it, to hand a provider's own calls the credential scope core already
  // uses for the same resource on a route (./issueDetail.ts, ./issueTools.ts).
  secrets: SecretService
  /** Host bindings are present in production. Optional only for narrow registry fixtures. */
  env?: Env
}

async function sourceScope(
  deps: AgentToolsDeps,
  ctx: ToolContext,
  input: { connectionId?: string; parameters?: Record<string, unknown> },
) {
  const task = await loadTask(deps.db, ctx.taskId)
  if (!task) throw new ToolError('not_found', 'no such task')
  const project = await projectForTask(deps.db, task)
  if (!project) throw new ToolError('not_found', 'no such project')
  return {
    workspaceId: project.workspaceId,
    projectId: project.id,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    parameters: input.parameters ?? {},
  }
}

const sourceTools = (deps: AgentToolsDeps): AgentToolContribution[] => {
  if (!deps.env) return []
  // The registry has already admitted the task-scoped read and sourceScope derives the only
  // workspace/project pair it may address. Broker provider credentials as the Node service, as
  // issue_detail does, rather than handing a task token to the credential runtime (which rejects it).
  const principal = (ctx: ToolContext) => ({
    kind: 'internal' as const,
    scope: 'service' as const,
    userId: ctx.userLogin,
  })
  const scopeInput = {
    connectionId: z.string().min(1).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }
  return [
    {
      name: 'dataset_write',
      description:
        'Write evidence-backed rows to an agent-fed dataset in this task project. The dataset schema and scope are fixed by its owner; corrections remain separate.',
      input: datasetWriteSchema,
      scope: 'task',
      risk: 'write',
      handler: async (input, ctx) => {
        const parsed = datasetWriteSchema.parse(input)
        const scope = await sourceScope(deps, ctx, {})
        const { assertDatasetWriteScope, getDataset, writeDatasetRows } = await import('../datasets/store.ts')
        const dataset = getDataset(deps.db, parsed.datasetId)
        if (!scope.projectId) throw new ToolError('bad_request', 'Dataset write needs a task project.')
        assertDatasetWriteScope(dataset, scope.workspaceId, scope.projectId)
        if (dataset.feeder !== 'agent') throw new ToolError('bad_request', 'Dataset does not accept agent rows.')
        return { written: writeDatasetRows(deps.db, dataset, parsed) }
      },
    },
    {
      name: 'data_sources_list',
      description:
        'List typed data sources available to the current task project. Read-only; returns descriptors, never credentials.',
      input: z.object(scopeInput).strict(),
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) =>
        listDataSources(deps.env!, await sourceScope(deps, ctx, input as never), {
          principal: principal(ctx),
          signal: new AbortController().signal,
        }),
    },
    {
      name: 'data_source_describe',
      description: 'Describe fields, parameters, operators, and capabilities for one available typed data source.',
      input: z.object({ pluginId: z.string().min(1), sourceId: z.string().min(1), ...scopeInput }).strict(),
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => {
        const value = input as {
          pluginId: string
          sourceId: string
          connectionId?: string
          parameters?: Record<string, unknown>
        }
        return invokeDataSource(
          deps.env!,
          {
            operation: 'describe',
            source: { pluginId: value.pluginId, sourceId: value.sourceId },
            scope: await sourceScope(deps, ctx, value),
          },
          { principal: principal(ctx), signal: new AbortController().signal },
        )
      },
    },
    {
      name: 'data_sources_discover',
      description:
        'Read one bounded page from an installed dynamic source discovery. This registers only the returned source descriptors and never returns credentials.',
      input: z
        .object({
          pluginId: z.string().min(1),
          discoveryId: z.string().min(1),
          cursor: z.string().min(1).max(4096).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          ...scopeInput,
        })
        .strict(),
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => {
        const value = input as {
          pluginId: string
          discoveryId: string
          cursor?: string
          pageSize?: number
          connectionId?: string
          parameters?: Record<string, unknown>
        }
        return discoverDataSources(
          deps.env!,
          {
            pluginId: value.pluginId,
            discoveryId: value.discoveryId,
            scope: await sourceScope(deps, ctx, value),
            pageSize: value.pageSize ?? 100,
            ...(value.cursor ? { cursor: value.cursor } : {}),
          },
          { principal: principal(ctx), signal: new AbortController().signal },
        )
      },
    },
    {
      name: 'data_source_options',
      description: 'Resolve a bounded page of real option ids and labels for a typed data source field or parameter.',
      input: z
        .object({
          pluginId: z.string().min(1),
          sourceId: z.string().min(1),
          target: z.enum(['field', 'parameter']),
          pointer: z.string().startsWith('/'),
          search: z.string().max(256).optional(),
          cursor: z.string().min(1).max(4096).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          ...scopeInput,
        })
        .strict(),
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => {
        const value = input as {
          pluginId: string
          sourceId: string
          target: 'field' | 'parameter'
          pointer: string
          search?: string
          cursor?: string
          pageSize?: number
          connectionId?: string
          parameters?: Record<string, unknown>
        }
        return invokeDataSource(
          deps.env!,
          {
            operation: 'options',
            source: { pluginId: value.pluginId, sourceId: value.sourceId },
            scope: await sourceScope(deps, ctx, value),
            target: value.target,
            pointer: value.pointer,
            search: value.search ?? '',
            pageSize: value.pageSize ?? 100,
            ...(value.cursor ? { cursor: value.cursor } : {}),
          },
          { principal: principal(ctx), signal: new AbortController().signal },
        )
      },
    },
  ]
}

async function assemble(deps: AgentToolsDeps, ctx: ToolContext, include: Set<string>) {
  const result = await assembleContext(deps.db, ctx.userLogin, ctx.taskId, include)
  if (!result) throw new ToolError('not_found', 'no such task')
  return result
}

const NO_PR = { status: 'no-pr', hint: 'This task has no linked pull request yet.' }

// Opening one calls the code host's API over the network, unlike the mirror reads.
const CREATE_DEADLINE_MS = 30_000

// Where `pr_create` opens a change request: the code host that holds the task project's repository,
// when it declared an `api`.
async function createTarget(db: AppDatabase, taskId: string) {
  const task = await loadTask(db, taskId)
  const project = task && (await projectForTask(db, task))
  const repository = project ? projectRepository(project) : null
  const api = repository?.provider ? changeRequestDeclaration(repository.provider)?.api : undefined
  return { task, repository, api }
}

// The change request tools ask the code host that owns the task's primary
// (docs/plugins/code-hosts.md § Agent context). `pr_current` and `pr_changed_files` read the `pr`
// section, which asks the same host.
const changeRequestTools = (deps: AgentToolsDeps): AgentToolContribution[] => {
  const { db, env } = deps
  return [
    {
      name: 'pr_review_comments',
      description:
        "What reviewers said about the current task's pull request: submitted reviews, inline comment threads, and conversation comments, from acorn's local mirror. Open threads only unless you ask for resolved ones.",
      input: z.object({
        includeResolved: z
          .boolean()
          .optional()
          .describe('include threads a reviewer has marked resolved (default: false)'),
      }),
      scope: 'task',
      risk: 'read',
      handler: async (raw, ctx) => {
        const host = await primaryChangeRequestHost(db, ctx.taskId)
        if (!host) return NO_PR
        const query = (raw as { includeResolved?: boolean }).includeResolved ? { includeResolved: 'true' } : undefined
        const feedback =
          env &&
          (await readChangeRequest(env, host, '/feedback', changeRequestFeedback, {
            userId: ctx.userLogin,
            taskId: ctx.taskId,
            query,
          }))
        // Absent is not empty. "Nothing mirrored" and "nobody has commented" are different answers,
        // and an agent that cannot tell them apart reports the wrong thing.
        return (
          feedback ?? {
            status: 'no-mirrored-pr',
            hint: "This task's pull request isn't mirrored yet. Open it in acorn once.",
          }
        )
      },
    },
    {
      name: 'pr_checks',
      description:
        "The CI checks on the current task's pull request from acorn's local mirror, with the failing and still-running ones called out. A running check has not failed.",
      input: z.object({}),
      scope: 'task',
      risk: 'read',
      handler: async (_raw, ctx) => {
        const host = await primaryChangeRequestHost(db, ctx.taskId)
        if (!host) return NO_PR
        const checks =
          env &&
          (await readChangeRequest(env, host, '/checks', changeRequestChecks, {
            userId: ctx.userLogin,
            taskId: ctx.taskId,
          }))
        return (
          checks ?? {
            status: 'no-mirrored-checks',
            hint: "No checks are mirrored for this task's pull request. This is not the same as a green PR.",
          }
        )
      },
    },
    {
      name: 'pr_create',
      description:
        "Open a pull request for this task's branch on its code host and attach it to the task. The first attached one becomes primary; later ones become related.",
      input: z.object({
        title: z.string().min(1).describe('Pull request title'),
        body: z.string().optional().describe('Pull request description'),
        base: z.string().min(1).describe('Base branch, for example main'),
        draft: z.boolean().optional().describe('Create as a draft pull request'),
      }),
      scope: 'task',
      risk: 'write',
      whenDescription:
        'Available when the task has a branch, a managed agent session, and a code host that can open a pull request.',
      when: async (ctx) => {
        if (!ctx.sessionId || !env) return false
        const { task, api } = await createTarget(db, ctx.taskId)
        return !!task?.branch && !!api
      },
      handler: async (raw, ctx) => {
        const input = raw as { title: string; body?: string; base: string; draft?: boolean }
        if (!ctx.sessionId)
          throw new ToolError('bad_request', 'A managed agent session is required to open a task pull request.')
        const { task, repository, api } = await createTarget(db, ctx.taskId)
        if (!task) throw new ToolError('not_found', 'Task not found.')
        if (!task.branch) throw new ToolError('bad_request', 'This task has no branch to open a pull request from.')
        if (!env || !repository?.provider || !api)
          throw new ToolError('bad_request', "This task's code host can't open a pull request from acorn.")
        // As the node, not the task: opening one spends the person's connection, which a task principal
        // can't (docs/security/credentials.md § Credential handling). The task rides in the body.
        const response = await askChangeRequestHost(
          env,
          repository.provider,
          api,
          { method: 'POST', body: JSON.stringify({ ...input, taskId: task.id, head: task.branch }) },
          { kind: 'internal', scope: 'service', userId: ctx.userLogin },
          CREATE_DEADLINE_MS,
        )
        if (!response) throw new ToolError('timeout', 'The code host did not answer in time.')
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        if (!response.ok)
          throw new ToolError(
            response.status === 400 || response.status === 422 ? 'bad_request' : 'failed',
            body?.error?.message ?? `The code host answered HTTP ${response.status}.`,
          )
        const created = changeRequestCreated.safeParse(body)
        if (!created.success) throw new ToolError('failed', 'The code host answered without a change request number.')
        const relation = await createTaskService(db).attachChangeRequest(task.id, {
          provider: repository.provider,
          path: repository.path,
          number: created.data.number,
          sourceBranch: task.branch,
          sessionId: ctx.sessionId,
        })
        // The code host's rail and badges show the task's change request, so it re-reads them.
        broadcastStatus(repository.provider)
        return { number: relation.number, relationship: relation.role }
      },
    },
  ]
}

export function buildAgentTools(deps: AgentToolsDeps): AgentToolContribution[] {
  const { db } = deps
  const empty = z.object({})

  // The context-read tools compose from the shared section registry (docs/agent-tools/context-sections.md § Context
  // sections); the /context route reads the same assembler.

  return [
    {
      name: 'task_scripts_status',
      description:
        'Read durable setup and teardown status for this task. Reads never start scripts. Setup running means installation may be incomplete.',
      input: z.strictObject({}),
      scope: 'task',
      risk: 'read',
      handler: async (_input, ctx) => taskScripts(db).status(ctx.taskId),
    },
    {
      name: 'task_scripts_wait',
      description:
        'Wait up to 30 seconds for one setup or teardown attempt to settle. Reads never start scripts. Timeout returns matched:false and does not cancel the script; bind retries with attemptId.',
      input: taskScriptWaitInputSchema,
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => taskScripts(db).wait(ctx.taskId, input, ctx.signal),
    },
    {
      name: 'task_scripts_logs',
      description:
        'Read a bounded diagnostic tail for this task script phase or attempt. Reads never start scripts. Check available and truncated.',
      input: taskScriptLogsInputSchema,
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => taskScripts(db).logs(ctx.taskId, input),
    },
    {
      name: 'task_current',
      description: 'The current acorn task: repo, branch, worktree path, PR number and linked issues.',
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const c = await assemble(deps, ctx, new Set(['issues']))
        const scripts = taskScripts(db).status(ctx.taskId)
        return {
          ...c.task,
          scripts: { generation: scripts.generation, setup: scripts.setup, teardown: scripts.teardown },
          scriptsHint:
            'Snapshot only. Reread task_scripts_status, task_scripts_wait, or task_scripts_logs before dependency-dependent work.',
          links: c.sections.find((section) => section.id === 'issues')?.items ?? [],
        }
      },
    },
    {
      name: 'task_context',
      description: 'The assembled context for the current task: PR detail, linked issues and notes. Compact by design.',
      input: z.object({
        include: z.string().optional().describe('comma list of context section ids (default: registry defaults)'),
      }),
      scope: 'task',
      risk: 'read',
      handler: (a, ctx) => assemble(deps, ctx, parseInclude((a as { include?: string }).include)),
    },
    {
      name: 'pr_current',
      description: "The current task's pull request (title, body, changed-file count) from acorn's local mirror.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) =>
        (await assemble(deps, ctx, new Set(['pr']))).sections.find((section) => section.id === 'pr')?.items[0] ?? {
          status: 'no-pr',
          hint: 'This task has no linked pull request yet.',
        },
    },
    {
      name: 'pr_changed_files',
      description: "The changed file paths of the current task's pull request.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) =>
        (await assemble(deps, ctx, new Set(['pr']))).sections.find((section) => section.id === 'pr')?.items[0]
          ?.details ?? [],
    },
    {
      name: 'linked_issues',
      description:
        'Issues/errors linked to the current task (Linear tickets, Rollbar items), resolved from the local cache.',
      input: z.object({ provider: z.string().optional().describe("filter by provider, e.g. 'linear' or 'rollbar'") }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const issues =
          (await assemble(deps, ctx, new Set(['issues']))).sections.find((section) => section.id === 'issues')?.items ??
          []
        const provider = (a as { provider?: string }).provider
        return provider ? issues.filter((item) => item.providerId === provider) : issues
      },
    },
    {
      name: 'repo_info',
      description:
        "The current task's repo: its remote host and path, the code host that owns it, default branch, task branch and worktree path. owner and name are set for a github.com remote.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const t = await loadTask(db, ctx.taskId)
        if (!t) throw new ToolError('not_found', 'no such task')
        const project = await projectForTask(db, t)
        const defaultBranch = project?.defaultBranch ?? null
        const repository = project ? projectRepository(project) : null
        const github = githubFacet(repository)
        return {
          repository,
          owner: github?.owner ?? null,
          name: github?.name ?? null,
          defaultBranch,
          branch: t.branch,
          worktreePath: t.worktreePath,
          projectId: t.projectId,
        }
      },
    },

    // Extending acorn itself: writing one (read tier). Importing the module also registers the
    // matching context section (docs/agent-tools/plugin-tools.md § plugin_authoring).
    pluginAuthoringTool(),
    // The only tool that can put third-party code on this node, by asking rather than installing
    // (docs/agent-tools/plugin-tools.md § plugin_request).
    pluginRequestTool(broadcastPluginApprovalNotice),
    // A ticket or an error, from the tracker that owns it. The comment and image tools act only on an
    // item this task links (./issueTools.ts).
    issueDetailTool(deps),
    issueCommentTool(deps),
    issueImageTool(deps),
    ...changeRequestTools(deps),
    ...sourceTools(deps),
    // Read tier, because it reads nothing itself. Each call the program makes passes that tool's own
    // gates, and only read-tier tools pass (./callTool.ts).
    {
      name: RUN_SCRIPT_TOOL,
      description:
        'Run a short JavaScript program that calls acorn tools and returns one result. `await tools.<name>(input)` calls any read-tier tool listed here with its usual input, and throws if the call is refused or fails. `return` the result; console.log goes to logs. No file, network, or timer access. Limits: 120 s, 1 s of JavaScript, 50 calls, 32 MiB.',
      input: z.object({ code: z.string().min(1).max(20_000) }),
      scope: 'task',
      risk: 'read',
      handler: async (input, ctx) => (await import('./runScript.ts')).runScript((input as { code: string }).code, ctx),
    },
  ]
}

let wiredSection: Disposable | undefined

export function wireAgentTools(deps: AgentToolsDeps): void {
  removeAgentTools(OWNER)
  for (const tool of buildAgentTools(deps)) registerAgentTool(OWNER, tool)
  // The `pr` section reaches code host routes through the env, so it registers here with the tools
  // that read it.
  wiredSection?.dispose()
  wiredSection = deps.env ? registerContextSection(OWNER, changeRequestSection(deps.env)) : undefined
}
