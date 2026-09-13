import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../shared/stepFields'
import { createDef, getDef } from './workflowDefs'
import { WorkflowDispatcher } from './workflowDispatch'
import { catalogValidation } from './generateWorkflow'
import { generateWorkflowRequest } from './generateWorkflowRequest'
import { resolveWorkflowGraph, type WorkflowResolutionScope } from './workflowResolution'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const stepResult = {
  status: 'ok' as const,
  exitCode: 0,
  capture: {
    result: 'reviewed',
    structuredOutput: null,
    sessionId: null,
    costUsd: null,
    events: [],
  },
  stderrTail: '',
}

describe('workflow dispatch authoring', () => {
  let store: TestPluginDb
  let runner: WorkflowRunner | null
  let unregisterProfile: () => void

  beforeEach(() => {
    store = makeTestPluginDb('workflows')
    runner = null
    unregisterProfile = agentProfileRegistry.register({
      id: DEFAULT_PROFILE_ID,
      label: 'Claude Code',
      kind: 'agent',
      command: 'claude',
      backendPreference: 'tmux',
      transport: 'pty',
    })
  })

  afterEach(async () => {
    runner?.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    unregisterProfile()
    store.cleanup()
  })

  it('generates, grounds, validates, saves, reopens, resolves, and runs a child workflow', async () => {
    const child = await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: {
        name: 'Review ticket',
        inputs: [{ name: 'ticket', required: true }],
        steps: [{ name: 'review', prompt: 'Review ${inputs.ticket}.' }],
      },
    })
    const catalog: WorkflowCatalog = {
      kinds: [
        { id: 'agent', pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS.agent },
        { id: 'workflow', pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS.workflow },
        { id: 'workflow-map', pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS['workflow-map'] },
      ],
      policies: [],
      profiles: [{ id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true }],
      workflows: [{
        ref: { source: 'database', id: child.id },
        name: child.name,
        inputs: [{ name: 'ticket', required: true }],
      }],
    }
    const generated: WorkflowDef = {
      name: 'Dispatch review',
      inputs: [{ name: 'ticket', required: true }],
      steps: [{
        name: 'dispatch',
        kind: 'workflow',
        childWorkflow: {
          ref: { source: 'database', id: child.id },
          inputs: { ticket: { from: 'input', name: 'ticket' } },
        },
      }],
    }
    const answer = await generateWorkflowRequest({
      request: {
        mode: 'overwrite',
        backendId: 'connection:test',
        description: 'Run the ticket review workflow.',
        workspaceId: 'workspace-1',
      },
      catalog,
      validation: catalogValidation(catalog),
      generateText: vi.fn(async () => ({
        text: JSON.stringify(generated),
        providerId: 'test',
        modelId: 'fixture',
      })),
    })
    expect(answer).toMatchObject({ repaired: false, problems: [] })
    if (!('def' in answer)) throw new Error(answer.error)

    const parent = await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: answer.def,
    })
    const reopened = await getDef(store.db, parent.id)
    expect(reopened?.def).toEqual(generated)

    const scope: WorkflowResolutionScope = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      repoDir: null,
      userDir: null,
    }
    const resolvedGraph = await resolveWorkflowGraph(store.db, reopened!.def, {
      scope,
      catalog: catalogValidation(catalog),
      inputs: { ticket: 'ACORN-42' },
      provenance: { source: 'database', id: parent.id, revision: parent.revision },
    })

    let dispatcher: WorkflowDispatcher
    const deps: RunnerDeps = {
      runStep: vi.fn(async () => stepResult),
      writeHandoff: vi.fn(async () => undefined),
      assembleContext: vi.fn(async () => ''),
      evaluatePolicy: vi.fn(async () => ({ pass: true })),
      failingChecks: vi.fn(async () => ''),
      notify: vi.fn(),
      runtimeWorkflowDispatchEnabled: true,
      dispatchChildWorkflow: (request, signal) => dispatcher.dispatch(request, signal),
      dispatchChildWorkflows: (requests, signal) => dispatcher.dispatchMany(requests, signal),
    }
    runner = new WorkflowRunner(store.db, deps)
    dispatcher = new WorkflowDispatcher(store.db, runner, {
      createChild: async (_parentTaskId, _seed, intendedTaskId) => intendedTaskId!,
    })
    const runId = await runner.start('parent-task', resolvedGraph.root, { resolvedGraph })

    await vi.waitFor(async () => expect((await runner!.run(runId))?.status).toBe('done'))
    expect(deps.runStep).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'review' }),
      expect.objectContaining({ prompt: 'Review ACORN-42.' }),
    )
  })
})
