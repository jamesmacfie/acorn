import { homedir } from 'node:os'
import { BridgeError, type CoreServices, type PluginDatabase } from '@acorn/plugin-api/node'
import { eq } from 'drizzle-orm'
import { loadWorkflowFiles } from '../definitions/files'
import { defsForProject } from '../definitions/store'
import { publishedWorkflow } from '../publication/store'
import { WorkflowProcessingStore } from '../processing/store'
import { workflowSelectionPage, workflowRecordAttemptPage, workflowRecordSnapshot } from '../processing/readModel'
import { prepareWorkflowReprocess } from '../processing/reprocess'
import { workflowRunById, workflowRunsForTask, workflowStepStatuses } from './read/readModel'
import { workflowRunList, workflowStepProjections, workflowTaskNavigation } from './read/projection'
import { workflowTaskResolutionScope } from '../definitions/resolution'
import { workflowRuns, workflowSteps } from '../../node/schema'
import type { WorkflowBridge } from '../routes/workflow'
import type { WorkflowRunner } from './runner'
import type { WorkflowDispatcher } from '../dispatch/dispatcher'
import type { WorkflowStartService } from './admission'
import type { WorkflowDef } from './runner'
import type { WorkflowGatesCapability } from '../../contract/events'

/** The route-facing commands and projections for an already connected execution pair. */
export const workflowControl = (
  store: PluginDatabase,
  core: CoreServices,
  runner: WorkflowRunner,
  dispatcher: WorkflowDispatcher,
  starts: WorkflowStartService,
  reconciled: Promise<void>,
): WorkflowBridge => {
  const taskScope = (taskId: string) => workflowTaskResolutionScope(core, taskId, homedir())
  return {
    // One column off this plugin's own runs table. See WorkflowBridge for why the router needs it.
    taskIdForRun: async (runId) => {
      const [row] = await store.select({ taskId: workflowRuns.taskId }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
      return row?.taskId ?? null
    },
    // Declared workflows for a task (docs/workflows.md): `.acorn/workflows/*.toml` from the
    // worktree/checkout plus ~/.acorn, with parse/cycle errors surfaced as palette rows.
    defs: async (taskId, includeRows) => {
      const scope = await taskScope(taskId)
      if (!scope) return { workflows: [], errors: [] }
      const files = loadWorkflowFiles(scope.repoDir, homedir(), runner.validationCatalog())
      if (!includeRows || !scope.project) return files
      const ids = new Set(files.workflows.map((workflow) => workflow.id))
      const rows = (await Promise.all((await defsForProject(store, scope.project.workspaceId, scope.project.id)).map(row => publishedWorkflow(store, row.id).catch(() => null)))).filter(row => row !== null)
      return {
        ...files,
        // A file wins an id collision, the rule the merged rail list applies as well.
        workflows: [...files.workflows, ...rows.filter((row) => !ids.has(row.id)).map((row) => ({ ...row.def, id: row.id, source: 'database' as const, publishedRevision: row.revision }))],
      }
    },
    catalog: (projectId) => starts.catalogForProject(projectId),
    start: (taskId, def, inputs, allowDatabaseDefinitions) =>
      starts.startDefinition(taskId, def as WorkflowDef, inputs, undefined, allowDatabaseDefinitions),
    startById: (taskId, defId, inputs, allowDatabaseDefinitions) =>
      starts.startById(taskId, defId, inputs, allowDatabaseDefinitions),
    runs: (taskId) => workflowRunsForTask(store, taskId),
    run: (runId) => workflowRunById(store, runId),
    // This plugin's contribution to the merged run list (@acorn/protocol/runs.ts). A projection,
    // not the rows: the merged list is display-shaped and deliberately narrow, and a caller that
    // wants a run's steps comes back to this plugin addressing it by id.
    allRuns: () => workflowRunList(store),
    taskNavigation: () => workflowTaskNavigation(store),
    steps: (runId) => workflowStepProjections(runner, runId),
    stepStatuses: (runId) => workflowStepStatuses(store, runId),
    records: async (runId, selectionId, after, limit, stepId, filter) =>
      workflowSelectionPage(store, runId, selectionId, after, limit, stepId, filter),
    recordAttempts: async (runId, recordId, after, limit) => workflowRecordAttemptPage(store, runId, recordId, after, limit),
    recordSnapshot: async (runId, recordId) => workflowRecordSnapshot(store, runId, recordId),
    prepareReprocess: async (runId, recordId) => prepareWorkflowReprocess(store, runId, recordId),
    reprocess: async (runId, recordId, digest, requestId) => {
      await reconciled
      return new WorkflowProcessingStore(store, dispatcher).reprocess({ sourceRunId: runId, recordId, digest, requestId })
    },
    gate: async (runId, stepId, approved, values) => {
      await reconciled // an approval resumes a step the restart sweep could otherwise clobber
      const resolution = await runner.resolveGate(runId, stepId, approved, values)
      if (resolution.outcome === 'not-found') throw new BridgeError(404, 'not_found', 'No such gate in this run.')
      if (resolution.outcome === 'already-resolved') throw new BridgeError(409, 'gate-resolved', 'This gate was already answered.')
      // One line per field, so the message names every problem. The run pane runs the same check
      // before it sends, so it has each one under its field already.
      if (resolution.outcome === 'invalid') {
        throw new BridgeError(400, 'gate-invalid', Object.entries(resolution.problems).map(([field, problem]) => `${field}: ${problem}`).join('\n'))
      }
      return { ok: true }
    },
    cancel: async (runId) => {
      await reconciled
      await runner.cancelRun(runId)
      return { ok: true }
    },
    kill: async (runId, stepId) => {
      await reconciled
      await runner.killStep(runId, stepId)
      return { ok: true }
    },
    retry: async (runId, stepId, prompt) => {
      await reconciled
      return runner.retryStep(runId, stepId, prompt)
    },
    // The chip the agent pane draws over a workflow session (docs/managed-agents/sessions.md § Sessions).
    // Two indexed reads rather than a join, because the session row is in another plugin's
    // database and this one only holds the id.
    runForSession: async (sessionId) => {
      const [step] = await store.select().from(workflowSteps).where(eq(workflowSteps.agentSessionId, sessionId)).limit(1)
      if (!step) return null
      const [run] = await store.select().from(workflowRuns).where(eq(workflowRuns.id, step.runId)).limit(1)
      return run ? { run, step } : null
    },
  }
}

/** Waiting gates are projected from this plugin's run and step rows. */
export const workflowGates = (store: PluginDatabase): WorkflowGatesCapability => ({
  list: async taskId => {
    const runs = await store.select().from(workflowRuns).where(eq(workflowRuns.taskId, taskId))
    const taskRuns = new Set(runs.map(run => run.id))
    if (!taskRuns.size) return []
    const steps = await store.select().from(workflowSteps)
    return steps
      .filter(step => taskRuns.has(step.runId) && step.status === 'waiting-gate')
      .map(step => ({ taskId, runId: step.runId, stepId: step.id, name: step.name, status: 'waiting-gate' as const }))
  },
})
