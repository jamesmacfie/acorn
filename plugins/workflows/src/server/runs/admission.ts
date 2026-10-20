import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { isRepoConfigTrustError, type PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowInternalStart } from '../../contract/runner'
import { generationWorkflowCatalog, scopedWorkflowCatalog } from '../definitions/catalog'
import type { WorkflowRunner } from './runner'
import {
  resolveScopedWorkflowDefinition,
  resolveWorkflowGraph,
  type WorkflowDefinitionProvenance,
  type WorkflowResolutionScope,
  type WorkflowTaskResolutionScope,
} from '../definitions/resolution'
import { WorkflowValidationError } from '../validation/definition'
import type {
  ToolCeiling,
  WorkflowBudget,
  WorkflowCatalog,
  WorkflowDef,
  WorkflowStartedBy,
} from '../../shared/workflowContracts'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import { publishedWorkflow } from '../publication/store'
import { asAuthorityError, WorkflowAuthorityError } from './authority'

type ProjectScope = {
  id: string
  workspaceId: string
  path: string | null
}

type WorkflowStartServiceDeps = {
  reconciled: Promise<void>
  taskScope(taskId: string): Promise<WorkflowTaskResolutionScope | null>
  project(projectId: string): Promise<ProjectScope | null | undefined>
  authorizeRepoConfig(taskId: string): Promise<void>
  authorizeProjectConfig?(projectId: string): Promise<void>
  onTrustRequired(taskId: string): void
  queryRevision?(queryId: string, scope: WorkflowResolutionScope): Promise<number>
  validateDestination?(graph: ResolvedWorkflowGraph, scope: WorkflowResolutionScope): Promise<void>
}

type InternalIdentity = {
  intendedRunId: string
  callerKey: string
  payloadFingerprint: string
  startedBy: WorkflowStartedBy
}

/** Resolves, freezes, and starts definitions for routes, triggers, and agent launches. */
export class WorkflowStartService {
  constructor(
    private readonly db: PluginDatabase,
    private readonly runner: WorkflowRunner,
    private readonly deps: WorkflowStartServiceDeps,
    private readonly userDir: string,
  ) {}

  async catalogForProject(projectId?: string): Promise<WorkflowCatalog> {
    const base = this.runner.catalog()
    if (!projectId) return { ...base, workflows: [] }
    const project = await this.deps.project(projectId)
    if (!project) return { ...base, workflows: [] }
    return scopedWorkflowCatalog({
      db: this.db,
      base,
      workspaceId: project.workspaceId,
      projectId: project.id,
      repoDir: project.path,
      userDir: this.userDir,
      validation: this.runner.validationCatalog(),
    })
  }

  async startDefinition(
    taskId: string,
    def: WorkflowDef,
    inputs?: Record<string, DataValue>,
    provenance?: WorkflowDefinitionProvenance,
    allowDatabaseDefinitions = true,
    internal?: InternalIdentity,
  ): Promise<{ runId?: string; error?: string }> {
    await this.deps.reconciled
    try {
      const scope = await this.deps.taskScope(taskId)
      if (!scope) return { error: 'That task no longer exists.' }
      const graph = await resolveWorkflowGraph(this.db, def, {
        scope,
        catalog: this.runner.validationCatalog(),
        inputs,
        provenance,
        allowDatabaseDefinitions,
        queryRevision: this.deps.queryRevision ? (id) => this.deps.queryRevision!(id, scope) : undefined,
      })
      if (graph.requiresRepoTrust) await this.deps.authorizeRepoConfig(taskId)
      await this.deps.validateDestination?.(graph, scope)
      return {
        runId: await this.runner.start(taskId, graph.root, {
          resolvedGraph: graph,
          ...(internal
            ? {
                startedBy: internal.startedBy,
                intendedRunId: internal.intendedRunId,
                invocation: {
                  callerKey: internal.callerKey,
                  payloadFingerprint: internal.payloadFingerprint,
                  rootRunId: internal.intendedRunId,
                  parentRunId: null,
                  parentStepId: null,
                  depth: 0,
                },
              }
            : {}),
        }),
      }
    } catch (error) {
      if (isRepoConfigTrustError(error)) {
        this.deps.onTrustRequired(taskId)
        return { error: 'needs-trust' }
      }
      return {
        error:
          error instanceof WorkflowValidationError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to start workflow.',
      }
    }
  }

  async startById(
    taskId: string,
    definitionId: string,
    inputs?: Record<string, DataValue>,
    allowDatabaseDefinitions = true,
    launchId?: string,
  ): Promise<{ runId?: string; error?: string }> {
    const fingerprint = launchId ? workflowContentFingerprint({ taskId, definitionId, inputs: inputs ?? {} }) : null
    const callerKey = launchId ? `device:${launchId}` : null
    if (callerKey) {
      const [existing] = await this.db
        .select()
        .from(schema.workflowRuns)
        .where(eq(schema.workflowRuns.invocationKey, callerKey))
      if (existing)
        return existing.taskId === taskId && existing.payloadFingerprint === fingerprint
          ? { runId: existing.id }
          : { error: 'This workflow launch ID was used with different task, definition, or inputs.' }
    }
    const scope = await this.deps.taskScope(taskId)
    if (!scope) return { error: 'That task no longer exists.' }
    try {
      const resolved = await resolveScopedWorkflowDefinition(
        this.db,
        this.definitionRef(definitionId),
        scope,
        this.runner.validationCatalog(),
      )
      return this.startDefinition(
        taskId,
        resolved.definition,
        inputs,
        resolved.provenance,
        allowDatabaseDefinitions,
        launchId
          ? { intendedRunId: launchId, callerKey: callerKey!, payloadFingerprint: fingerprint!, startedBy: 'manual' }
          : undefined,
      )
    } catch (error) {
      return { error: error instanceof WorkflowValidationError ? error.message : 'Failed to resolve workflow.' }
    }
  }

  async startInternal(request: WorkflowInternalStart): Promise<string> {
    let definition: WorkflowDef
    let provenance: WorkflowDefinitionProvenance | undefined
    if ('workflowId' in request) {
      const scope = await this.deps.taskScope(request.taskId)
      if (!scope) throw new Error('That task no longer exists.')
      const resolved = await resolveScopedWorkflowDefinition(
        this.db,
        this.definitionRef(request.workflowId),
        scope,
        this.runner.validationCatalog(),
      )
      definition = resolved.definition
      provenance = resolved.provenance
    } else {
      definition = request.workflow
    }
    const started = await this.startDefinition(request.taskId, definition, request.inputs, provenance, true, request)
    if (!started.runId) throw new Error(started.error ?? 'Failed to start workflow.')
    return started.runId
  }

  async prepareTriggered(
    projectId: string,
    definitionId: string,
    inputs?: Record<string, DataValue>,
  ): Promise<{ graph: ResolvedWorkflowGraph; scope: WorkflowResolutionScope }> {
    return this.prepareInvocation({ projectId }, definitionId, inputs ?? {})
  }

  /** Resolves and checks a saved definition outside a device start: for a trigger or the owner's
   *  agent invocation review (a project), or for an agent's launch (a task, whose checkout supplies
   *  repository files). A `review` has no caller values yet, so required inputs are left unchecked,
   *  and it skips the trust check, which a start makes on its own. Neither changes the graph's
   *  executable shape. A refusal only the owner can fix throws WorkflowAuthorityError. */
  async prepareInvocation(
    target: { projectId: string } | { taskId: string },
    definitionId: string,
    inputs: Record<string, DataValue>,
    purpose: 'review' | 'start' = 'start',
  ): Promise<{ graph: ResolvedWorkflowGraph; scope: WorkflowResolutionScope }> {
    let scope: WorkflowResolutionScope
    if ('taskId' in target) {
      const taskScope = await this.deps.taskScope(target.taskId)
      if (!taskScope) throw new WorkflowAuthorityError('missing', 'That task no longer exists.')
      scope = taskScope
    } else {
      const project = await this.deps.project(target.projectId)
      if (!project) throw new WorkflowAuthorityError('missing', 'That project no longer exists.')
      scope = { workspaceId: project.workspaceId, projectId: project.id, repoDir: project.path, userDir: this.userDir }
    }
    const ref = this.definitionRef(definitionId)
    if (ref.source === 'database' && !(await publishedWorkflow(this.db, ref.id)))
      throw new WorkflowAuthorityError('not-published', 'That workflow is no longer published.')
    const resolved = await resolveScopedWorkflowDefinition(this.db, ref, scope, this.runner.validationCatalog())
    const definition =
      purpose === 'review' && resolved.definition.inputs
        ? { ...resolved.definition, inputs: resolved.definition.inputs.map((input) => ({ ...input, required: false })) }
        : resolved.definition
    const graph = await resolveWorkflowGraph(this.db, definition, {
      scope,
      catalog: this.runner.validationCatalog(),
      inputs,
      provenance: resolved.provenance,
      allowDatabaseDefinitions: true,
      queryRevision: this.deps.queryRevision ? (id) => this.deps.queryRevision!(id, scope) : undefined,
    })
    try {
      if (graph.requiresRepoTrust && purpose === 'start') {
        if ('taskId' in target) await this.deps.authorizeRepoConfig(target.taskId)
        else
          await this.deps.authorizeProjectConfig?.(target.projectId).catch((error: unknown) => {
            // The project exists (checked above), so this check refuses only an unreviewed configuration.
            throw new WorkflowAuthorityError('untrusted', error instanceof Error ? error.message : String(error))
          })
      }
      await this.deps.validateDestination?.(graph, scope)
    } catch (error) {
      throw asAuthorityError(error)
    }
    return { graph, scope }
  }

  /** Starts a trigger's root run. A refusal only the owner can fix throws WorkflowAuthorityError. */
  async startTriggered(request: {
    triggerId: string
    taskId: string
    graph: ResolvedWorkflowGraph
    intendedRunId: string
    callerKey: string
    payloadFingerprint: string
    inputs: Record<string, DataValue>
    processingScope: import('../../shared/workflowProcessing').WorkflowProcessingScope
    baseline?: boolean
  }): Promise<string> {
    await this.deps.reconciled
    try {
      if (request.graph.requiresRepoTrust) await this.deps.authorizeRepoConfig(request.taskId)
      const scope = await this.deps.taskScope(request.taskId)
      if (!scope) throw new WorkflowAuthorityError('missing', 'That task no longer exists.')
      await this.deps.validateDestination?.(request.graph, scope)
    } catch (error) {
      throw asAuthorityError(error)
    }
    return this.runner.start(request.taskId, request.graph.root, {
      inputs: request.inputs,
      resolvedGraph: request.graph,
      intendedRunId: request.intendedRunId,
      invocation: {
        callerKey: request.callerKey,
        payloadFingerprint: request.payloadFingerprint,
        rootRunId: request.intendedRunId,
        parentRunId: null,
        parentStepId: null,
        depth: 0,
      },
      processingScope: request.processingScope,
      processingBaseline: request.baseline ?? false,
      startedBy: 'trigger',
      triggerId: request.triggerId,
    })
  }

  /** Starts an agent launch that was admitted and persisted earlier (../agentTools/launches.ts). The
   *  intended run ID makes a repeat after a restart return the same run. */
  async startAgentLaunch(request: {
    taskId: string
    graph: ResolvedWorkflowGraph
    intendedRunId: string
    callerKey: string
    payloadFingerprint: string
    effectiveBudget: WorkflowBudget
    effectiveTools: ToolCeiling
  }): Promise<string> {
    await this.deps.reconciled
    if (request.graph.requiresRepoTrust) await this.deps.authorizeRepoConfig(request.taskId)
    const scope = await this.deps.taskScope(request.taskId)
    if (!scope) throw new Error('That task no longer exists.')
    await this.deps.validateDestination?.(request.graph, scope)
    return this.runner.start(request.taskId, request.graph.root, {
      resolvedGraph: request.graph,
      intendedRunId: request.intendedRunId,
      invocation: {
        callerKey: request.callerKey,
        payloadFingerprint: request.payloadFingerprint,
        rootRunId: request.intendedRunId,
        parentRunId: null,
        parentStepId: null,
        depth: 0,
      },
      startedBy: 'agent-tool',
      effectiveBudget: request.effectiveBudget,
      effectiveTools: request.effectiveTools,
    })
  }

  async generationCatalog(projectId: string | undefined, excludeId: string | undefined): Promise<WorkflowCatalog> {
    return generationWorkflowCatalog(await this.catalogForProject(projectId), excludeId)
  }

  private definitionRef(definitionId: string) {
    const file = /^(repo|user):(.+)$/.exec(definitionId)
    if (!file) return { source: 'database' as const, id: definitionId }
    return file[1] === 'repo'
      ? { source: 'repo' as const, path: `.acorn/workflows/${file[2]}.toml` }
      : { source: 'user' as const, id: file[2]! }
  }
}
