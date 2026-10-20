import { afterEach, beforeEach, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CompiledCoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../../node/schema'
import type { ResolvedWorkflowGraph } from '../../../shared/workflowContracts'
import type { WorkflowTriggerFirstCheck } from '../../../shared/workflowTriggers'
import { workflowContentFingerprint } from '../../definitions/resolution'
import type { WorkflowStartService } from '../../runs/admission'
import { WorkflowTriggerService, type WorkflowTriggerScheduler } from '../service'

export const graph = (prompt = 'Review it'): ResolvedWorkflowGraph => {
  const definition = {
    baseline: 'acorn-1' as const,
    formatVersion: 1 as const,
    name: 'Scheduled review',
    inputs: [{ name: 'count', schema: { type: 'number' as const }, required: true }],
    steps: [{ id: 'review', name: 'Review', prompt }],
  }
  const nodes = [
    {
      path: ['$'],
      depth: 0,
      definition,
      provenance: { source: 'database' as const, id: 'workflow-1', revision: 1 },
      defaultInputs: { count: 2 },
      fingerprint: 'node',
    },
  ]
  return {
    root: definition,
    nodes,
    fingerprint: workflowContentFingerprint(
      nodes.map(({ path, definition: def, provenance, defaultInputs }) => ({
        path,
        definition: def,
        provenance,
        defaultInputs,
      })),
    ),
    requiresRepoTrust: false,
  }
}

export const clock = (timezone = 'Pacific/Auckland') => ({ kind: 'clock' as const, timezone })

/** A trigger service over a fresh plugin database, with core tasks and run starts faked. A started run
 *  stays `running` until a test settles it. */
export function useTriggerHarness() {
  const harness = {
    database: undefined as unknown as TestPluginDb,
    currentGraph: graph(),
    service: undefined as unknown as WorkflowTriggerService,
    starts: {
      prepareTriggered: vi.fn(async () => ({
        graph: harness.currentGraph,
        scope: { workspaceId: 'workspace-1', projectId: 'project-1', repoDir: null, userDir: null },
      })),
      startTriggered: vi.fn(async (request: Parameters<WorkflowStartService['startTriggered']>[0]) => {
        harness.database.db
          .insert(schema.workflowRuns)
          .values({
            id: request.intendedRunId,
            taskId: request.taskId,
            name: request.graph.root.name,
            status: 'running',
            startedBy: 'trigger',
            triggerId: request.triggerId,
            defJson: JSON.stringify(request.graph.root),
            resolvedGraphJson: JSON.stringify(request.graph),
            rootRunId: request.intendedRunId,
            invocationKey: request.callerKey,
            payloadFingerprint: request.payloadFingerprint,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run()
        return request.intendedRunId
      }),
    },
    tasks: { createRoot: vi.fn(async (_project: string, _seed: unknown, intended: string) => intended) },
    /** A second service, as another connection or with a scheduler, over the same database. */
    serviceFor: (db: PluginDatabase, scheduler?: () => WorkflowTriggerScheduler) =>
      new WorkflowTriggerService(
        db,
        harness.starts as unknown as WorkflowStartService,
        { tasks: harness.tasks, projects: {} } as unknown as Pick<CompiledCoreServices, 'tasks' | 'projects'>,
        Promise.resolve(),
        scheduler ? { scheduler } : {},
      ),
    approved: async (firstCheck: WorkflowTriggerFirstCheck = 'process-current') => {
      const saved = harness.service.save({
        projectId: 'project-1',
        workflowId: 'workflow-1',
        when: clock(),
        inputs: { count: 2 },
      })
      return harness.service.approve(saved.id, firstCheck)
    },
    occurrences: () => harness.database.db.select().from(schema.workflowTriggerOccurrences).all(),
    occurrence: () => harness.database.db.select().from(schema.workflowTriggerOccurrences).get()!,
  }
  beforeEach(() => {
    harness.database = makeTestPluginDb('workflows')
    harness.currentGraph = graph()
    vi.clearAllMocks()
    harness.service = harness.serviceFor(harness.database.db)
  })
  afterEach(() => harness.database.cleanup())
  return harness
}
