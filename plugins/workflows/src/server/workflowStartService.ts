import { isRepoConfigTrustError, type PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowInternalStart } from '../contract/runner'
import { generationWorkflowCatalog, scopedWorkflowCatalog } from './workflowCatalog'
import type { WorkflowRunner } from './workflowRunner'
import {
  resolveScopedWorkflowDefinition,
  resolveWorkflowGraph,
  type WorkflowDefinitionProvenance,
  type WorkflowTaskResolutionScope,
} from './workflowResolution'
import { WorkflowValidationError } from './workflowValidation'
import type { WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'

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
  onTrustRequired(taskId: string): void
}

type InternalIdentity = {
  intendedRunId: string
  callerKey: string
  payloadFingerprint: string
  trigger: string
}

/** Resolves, freezes, and starts definitions for routes and internal schedulers. */
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
    inputs?: Record<string, string>,
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
      })
      if (graph.requiresRepoTrust) await this.deps.authorizeRepoConfig(taskId)
      return {
        runId: await this.runner.start(taskId, graph.root, {
          resolvedGraph: graph,
          ...(internal
            ? {
                trigger: internal.trigger,
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
        error: error instanceof WorkflowValidationError
          ? error.message
          : error instanceof Error ? error.message : 'Failed to start workflow.',
      }
    }
  }

  async startById(
    taskId: string,
    definitionId: string,
    inputs?: Record<string, string>,
    allowDatabaseDefinitions = true,
  ): Promise<{ runId?: string; error?: string }> {
    const scope = await this.deps.taskScope(taskId)
    if (!scope) return { error: 'That task no longer exists.' }
    try {
      const resolved = await resolveScopedWorkflowDefinition(
        this.db,
        this.definitionRef(definitionId),
        scope,
        this.runner.validationCatalog(),
      )
      return this.startDefinition(taskId, resolved.definition, inputs, resolved.provenance, allowDatabaseDefinitions)
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
