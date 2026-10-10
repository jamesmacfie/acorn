// The workflow agent tool services, built on first use (./activation.ts). Nothing here is on the Node's
// boot path: the tool names and schemas register at init, and this module loads with the first call.
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentRequestsCapability, AgentTurnsCapability } from '@acorn/plugin-agents/contract/lifecycle.ts'
import type { WorkflowChildRunSummary } from '../../shared/api'
import type { WorkflowDraftWriter } from '../definitions/activation'
import type { CallerLookup } from './caller'
import { catalogPage, getDefinition, listDefinitions, validateCandidate, type WorkflowToolDeps } from './discovery'
import { WorkflowAgentDrafts } from './drafts'
import { WorkflowInvocationPolicies, type PrepareInvocation } from './invocation'
import { WorkflowAgentLaunches, type WorkflowLaunchDeps } from './launches'
import { WorkflowRunReads } from './runReads'

export type WorkflowAgentServiceDeps = Omit<WorkflowToolDeps, 'invocation'> & {
  db: PluginDatabase
  prepare: PrepareInvocation
  writer: WorkflowDraftWriter
  caller: CallerLookup
  turns(): AgentTurnsCapability | undefined
  requests(): AgentRequestsCapability | undefined
  childRuns(stepId: string): Promise<WorkflowChildRunSummary[]>
  startLaunch: WorkflowLaunchDeps['startLaunch']
  cancelRun(runId: string): Promise<void>
  checkoutPath(taskId: string): Promise<string | null>
  audit: WorkflowLaunchDeps['audit']
  warn(message: string): void
}

export function createWorkflowAgentServices(deps: WorkflowAgentServiceDeps) {
  const base: WorkflowToolDeps = { db: deps.db, catalog: deps.catalog, validationCatalog: deps.validationCatalog, taskScope: deps.taskScope }
  const policies = new WorkflowInvocationPolicies({ ...base, prepare: deps.prepare, audit: deps.audit })
  const launches = new WorkflowAgentLaunches({ ...deps, ...base, policies })
  const discovery: WorkflowToolDeps = { ...base, invocation: launches.readiness.bind(launches) }
  return {
    catalog: (cursor: string | undefined) => catalogPage(discovery, cursor),
    list: (context: Parameters<typeof listDefinitions>[1], input: Parameters<typeof listDefinitions>[2]) => listDefinitions(discovery, context, input),
    get: (taskId: string, input: Parameters<typeof getDefinition>[2]) => getDefinition(discovery, taskId, input),
    validate: (taskId: string, candidate: unknown) => validateCandidate(discovery, taskId, candidate),
    drafts: new WorkflowAgentDrafts({ ...base, writer: deps.writer, caller: deps.caller, audit: deps.audit }),
    policies,
    launches,
    reads: new WorkflowRunReads({ db: deps.db, launches, caller: deps.caller, childRuns: deps.childRuns, requests: deps.requests }),
  }
}

export type WorkflowAgentServices = ReturnType<typeof createWorkflowAgentServices>
