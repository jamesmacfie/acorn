import { homedir } from 'node:os'
import { and, eq, inArray } from 'drizzle-orm'
import { BridgeError, describeError, lazyRouter, type NodePlugin, type PluginDatabase } from '@acorn/plugin-api/node'
import { AGENTS_REQUESTS, AGENTS_TURNS } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { AGENTS_TOOL_CALLER } from '@acorn/plugin-agents/contract/toolCaller.ts'
import { workflowAgentLaunches } from '../../node/schema'
import type { WorkflowDraftWriter } from '../definitions/activation'
import { workflowTaskResolutionScope } from '../definitions/resolution'
import type { WorkflowStartService } from '../runs/admission'
import type { WorkflowRunner } from '../runs/runner'
import { WORKFLOW_INVOCATION_ROUTE } from '../routes/invocationBridge'
import type { WorkflowAgentServices } from './services'
import { workflowAgentTools } from './tools'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]

const AUDIT_ACTIONS = [
  { id: 'agent-draft-saved', label: 'Agent saved a workflow draft' },
  { id: 'agent-invocation-approved', label: 'Allowed agents to start a workflow' },
  { id: 'agent-invocation-revoked', label: 'Stopped agents starting a workflow' },
  { id: 'agent-run-launched', label: 'Agent started a workflow' },
  { id: 'agent-run-cancelled', label: 'Agent cancelled a workflow it started' },
]

/** Registers the workflow agent tools and the owner's approval routes (docs/agent-tools/workflow-tools.md).
 *  The tools' code loads on the first call, so it stays off the Node's boot path. The host removes the
 *  tools and routes with the plugin; `dispose` drops the turn subscription the host cannot see. */
export function activateWorkflowAgentTools(args: {
  store: PluginDatabase
  ctx: PluginContext
  runner: WorkflowRunner
  starts: WorkflowStartService
  drafts: WorkflowDraftWriter
  reconciled: Promise<void>
}): { dispose(): void } {
  const { store, ctx, runner, starts, reconciled } = args
  const core = ctx.core
  for (const action of AUDIT_ACTIONS) ctx.audit.declare(action)
  const warn = (message: string) => ctx.log.warn(message)
  // Resolved per call: plugin init order is not defined, and Agents may be disabled.
  const caller = () => ctx.capabilities.get(AGENTS_TOOL_CALLER)

  let loading: Promise<WorkflowAgentServices> | null = null
  const load = (): Promise<WorkflowAgentServices> => loading ??= import('./services').then(({ createWorkflowAgentServices }) => createWorkflowAgentServices({
    db: store,
    catalog: () => runner.catalog(),
    validationCatalog: () => runner.validationCatalog(),
    taskScope: (taskId) => workflowTaskResolutionScope(core, taskId, homedir()),
    prepare: (target, definitionId, inputs, purpose) => starts.prepareInvocation(target, definitionId, inputs, purpose),
    writer: args.drafts,
    caller,
    turns: () => ctx.capabilities.get(AGENTS_TURNS),
    requests: () => ctx.capabilities.get(AGENTS_REQUESTS),
    childRuns: (stepId) => runner.childRuns(stepId),
    startLaunch: (request) => starts.startAgentLaunch(request),
    cancelRun: async (runId) => {
      await reconciled
      await runner.cancelRun(runId)
    },
    checkoutPath: async (taskId) => {
      const task = await core.tasks.load(taskId)
      if (!task) return null
      return task.worktreePath ?? (await core.projects.byId(task.projectId))?.path ?? null
    },
    audit: (action, entry) => ctx.audit.record(action, entry),
    warn,
  })).catch((error: unknown) => {
    // A failed load is retried by the next call rather than cached.
    loading = null
    throw error
  })

  for (const tool of workflowAgentTools(load, caller)) ctx.tools.register(tool)

  // A refusal the owner reads in the review dialog, not a server fault.
  const forOwner = async <T>(work: (services: WorkflowAgentServices) => Promise<T> | T): Promise<T> => {
    try { return await work(await load()) } catch (error) {
      if (error instanceof BridgeError) throw error
      throw new BridgeError(409, 'invocation_refused', describeError(error).message)
    }
  }
  const route = ctx.capabilities.provide(WORKFLOW_INVOCATION_ROUTE, {
    review: (projectId, key) => forOwner((services) => services.policies.review(projectId, key)),
    approve: (approval) => forOwner((services) => services.policies.approve(approval)),
    revoke: (projectId, key) => forOwner((services) => services.policies.revoke(projectId, key)),
  })
  ctx.routes.register(lazyRouter(async () => (await import('../routes/invocation')).workflowInvocationRoutes),
    { prefix: '/workflows/invocation', note: 'agent invocation approvals, device only' })

  // After the restart sweep: settled turns release launches waiting on their caller, a stopped turn
  // stops its session's launched runs, and launches still waiting from before a restart are checked.
  // Both look in this plugin's own table first, so a Node with no agent launches loads nothing.
  const launchesFor = (sessionId?: string) => store.select({ id: workflowAgentLaunches.id }).from(workflowAgentLaunches)
    .where(and(inArray(workflowAgentLaunches.state, ['awaiting-caller', 'started']), sessionId ? eq(workflowAgentLaunches.sessionId, sessionId) : undefined))
    .limit(1).get()
  let active = true
  let unsubscribe: (() => void) | null = null
  void reconciled.then(async () => {
    if (!active) return
    unsubscribe = caller()?.onTurnSettled((turn) => {
      if (!launchesFor(turn.sessionId)) return
      void load().then((services) => services.launches.turnSettled(turn))
        .catch((error) => warn(`agent launch handoff failed: ${describeError(error).message}`))
    }) ?? null
    if (launchesFor()) await (await load()).launches.reconcile()
  }).catch((error) => warn(`agent launch recovery failed: ${describeError(error).message}`))

  return {
    dispose: () => {
      active = false
      unsubscribe?.()
      route.dispose()
    },
  }
}
