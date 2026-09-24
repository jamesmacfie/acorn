import { z } from 'zod'
import { assembleContext, parseInclude } from './contextSections.ts'
import { pluginAuthoringTool } from './pluginAuthoring.ts'
import { pluginRequestTool } from './pluginRequests.ts'
import { registerAgentTool, removeAgentTools, ToolError, type AgentToolContribution, type ToolContext } from './registry.ts'
import { issueDetailTool } from './issueDetail.ts'
import { issueCommentTool, issueImageTool } from './issueTools.ts'
import type { AppDatabase } from '../db/index.ts'
import type { SecretService } from '../core/secrets.ts'
import type { Env } from '../bindings.ts'
import { discoverDataSources, invokeDataSource, listDataSources } from '../dataSources/runtime.ts'
import { broadcastPluginApprovalNotice } from '../notify.ts'
import { loadTask, projectForTask } from '../worktrees/taskWorktree.ts'

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

async function sourceScope(deps: AgentToolsDeps, ctx: ToolContext, input: { connectionId?: string; parameters?: Record<string, unknown> }) {
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
  const principal = (ctx: ToolContext) => ({ kind: 'internal' as const, scope: 'service' as const, userId: ctx.userLogin })
  const scopeInput = { connectionId: z.string().min(1).optional(), parameters: z.record(z.string(), z.unknown()).optional() }
  return [
    {
      name: 'data_sources_list',
      description: 'List typed data sources available to the current task project. Read-only; returns descriptors, never credentials.',
      input: z.object(scopeInput).strict(), scope: 'task', risk: 'read',
      handler: async (input, ctx) => listDataSources(deps.env!, await sourceScope(deps, ctx, input as never), { principal: principal(ctx), signal: new AbortController().signal }),
    },
    {
      name: 'data_source_describe',
      description: 'Describe fields, parameters, operators, and capabilities for one available typed data source.',
      input: z.object({ pluginId: z.string().min(1), sourceId: z.string().min(1), ...scopeInput }).strict(), scope: 'task', risk: 'read',
      handler: async (input, ctx) => {
        const value = input as { pluginId: string; sourceId: string; connectionId?: string; parameters?: Record<string, unknown> }
        return invokeDataSource(deps.env!, { operation: 'describe', source: { pluginId: value.pluginId, sourceId: value.sourceId }, scope: await sourceScope(deps, ctx, value) }, { principal: principal(ctx), signal: new AbortController().signal })
      },
    },
    {
      name: 'data_sources_discover',
      description: 'Read one bounded page from an installed dynamic source discovery. This registers only the returned source descriptors and never returns credentials.',
      input: z.object({
        pluginId: z.string().min(1), discoveryId: z.string().min(1), cursor: z.string().min(1).max(4096).optional(),
        pageSize: z.number().int().min(1).max(100).optional(), ...scopeInput,
      }).strict(), scope: 'task', risk: 'read',
      handler: async (input, ctx) => {
        const value = input as { pluginId: string; discoveryId: string; cursor?: string; pageSize?: number; connectionId?: string; parameters?: Record<string, unknown> }
        return discoverDataSources(deps.env!, {
          pluginId: value.pluginId, discoveryId: value.discoveryId, scope: await sourceScope(deps, ctx, value),
          pageSize: value.pageSize ?? 100, ...(value.cursor ? { cursor: value.cursor } : {}),
        }, { principal: principal(ctx), signal: new AbortController().signal })
      },
    },
    {
      name: 'data_source_options',
      description: 'Resolve a bounded page of real option ids and labels for a typed data source field or parameter.',
      input: z.object({
        pluginId: z.string().min(1), sourceId: z.string().min(1), target: z.enum(['field', 'parameter']), pointer: z.string().startsWith('/'),
        search: z.string().max(256).optional(), cursor: z.string().min(1).max(4096).optional(), pageSize: z.number().int().min(1).max(100).optional(), ...scopeInput,
      }).strict(), scope: 'task', risk: 'read',
      handler: async (input, ctx) => {
        const value = input as { pluginId: string; sourceId: string; target: 'field' | 'parameter'; pointer: string; search?: string; cursor?: string; pageSize?: number; connectionId?: string; parameters?: Record<string, unknown> }
        return invokeDataSource(deps.env!, {
          operation: 'options', source: { pluginId: value.pluginId, sourceId: value.sourceId }, scope: await sourceScope(deps, ctx, value),
          target: value.target, pointer: value.pointer, search: value.search ?? '', pageSize: value.pageSize ?? 100,
          ...(value.cursor ? { cursor: value.cursor } : {}),
        }, { principal: principal(ctx), signal: new AbortController().signal })
      },
    },
  ]
}

async function assemble(deps: AgentToolsDeps, ctx: ToolContext, include: Set<string>) {
  const result = await assembleContext(deps.db, ctx.userLogin, ctx.taskId, include)
  if (!result) throw new ToolError('not_found', 'no such task')
  return result
}

export function buildAgentTools(deps: AgentToolsDeps): AgentToolContribution[] {
  const { db } = deps
  const empty = z.object({})

  // The context-read tools compose from the shared section registry (docs/agent-tools.md § Context
  // sections); the /context route reads the same assembler.

  return [
    {
      name: 'task_current',
      description: "The current acorn task: repo, branch, worktree path, PR number and linked issues.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const c = await assemble(deps, ctx, new Set(['issues']))
        return { ...c.task, links: c.issues }
      },
    },
    {
      name: 'task_context',
      description: 'The assembled context for the current task: PR detail, linked issues, notes and the repo memory index. Compact by design.',
      input: z.object({ include: z.string().optional().describe('comma list of context section ids (default: registry defaults)') }),
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
      handler: async (_a, ctx) => (await assemble(deps, ctx, new Set(['pr']))).pr ?? { status: 'no-pr', hint: 'This task has no linked pull request yet.' },
    },
    {
      name: 'pr_changed_files',
      description: "The changed file paths of the current task's pull request.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => (await assemble(deps, ctx, new Set(['pr']))).pr?.changedFiles ?? [],
    },
    {
      name: 'linked_issues',
      description: 'Issues/errors linked to the current task (Linear tickets, Rollbar items), resolved from the local cache.',
      input: z.object({ provider: z.string().optional().describe("filter by provider, e.g. 'linear' or 'rollbar'") }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const issues = (await assemble(deps, ctx, new Set(['issues']))).issues
        const provider = (a as { provider?: string }).provider
        return provider ? issues.filter((i) => i.provider === provider) : issues
      },
    },
    {
      name: 'repo_info',
      description: "The current task's repo: owner, name, default branch, task branch and worktree path.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const t = await loadTask(db, ctx.taskId)
        if (!t) throw new ToolError('not_found', 'no such task')
        const project = await projectForTask(db, t)
        const defaultBranch = project?.defaultBranch ?? null
        return { owner: project?.githubOwner ?? null, name: project?.githubName ?? null, defaultBranch, branch: t.branch, worktreePath: t.worktreePath, projectId: t.projectId }
      },
    },

    // Extending acorn itself: writing one (read tier). Importing the module also registers the
    // matching context section (docs/agent-tools.md § plugin_authoring).
    pluginAuthoringTool(),
    // The only tool that can put third-party code on this node, by asking rather than installing
    // (docs/agent-tools.md § plugin_request).
    pluginRequestTool(broadcastPluginApprovalNotice),
    // A ticket or an error, from the tracker that owns it. The comment and image tools act only on an
    // item this task links (./issueTools.ts).
    issueDetailTool(deps),
    issueCommentTool(deps),
    issueImageTool(deps),
    ...sourceTools(deps),
  ]
}

export function wireAgentTools(deps: AgentToolsDeps): void {
  removeAgentTools(OWNER)
  for (const tool of buildAgentTools(deps)) registerAgentTool(OWNER, tool)
}
