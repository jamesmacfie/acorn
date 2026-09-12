import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTestCoreServices,
  makeTestDb,
  makeTestPluginDb,
  type TestDb,
  type TestPluginDb,
} from '@acorn/node-core/testkit/db.ts'
import { schema as coreSchema } from '@acorn/node-core/server/db/index.ts'
import {
  catalogValidation,
  createDef,
  generateWorkflowRequest,
  loadWorkflowFiles,
  resolveWorkflowGraph,
  WorkflowDispatcher,
  workflowDispatches,
  WorkflowRunner,
  workflowRuns,
  type RunnerDeps,
  type WorkflowCatalog,
  type WorkflowDef,
} from '@acorn/plugin-workflows/testkit'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

registerBuiltInProfiles()
const DEFAULT_PROFILE_ID = 'claude-code'

const tickets = [
  { id: 'ticket-42', number: 'ACORN-42' },
  { id: 'ticket-43', number: 'ACORN-43' },
]

const succeeded = (result: string, structuredOutput: unknown) => ({
  status: 'ok' as const,
  exitCode: 0,
  capture: { result, structuredOutput, sessionId: null, costUsd: 0, events: [] },
  stderrTail: '',
})

const ticketMap = (childId: string): WorkflowDef => ({
  name: 'Review selected tickets',
  steps: [
    { name: 'select', after: [], prompt: 'Select tickets.', schema: { type: 'object' } },
    {
      name: 'review', kind: 'workflow-map', after: ['select'],
      items: { step: 'select', pointer: '/tickets' }, itemKey: '/id',
      childWorkflow: {
        ref: { source: 'database', id: childId },
        inputs: { ticket: { from: 'item', pointer: '/number' } },
      },
      title: {
        template: 'Review ${ticket}',
        bindings: { ticket: { from: 'item', pointer: '/number' } },
      },
    },
  ],
})

describe('workflow task acceptance', () => {
  let core: TestDb
  let workflows: TestPluginDb
  let dir: string
  const runners: WorkflowRunner[] = []

  beforeEach(async () => {
    core = makeTestDb()
    workflows = makeTestPluginDb('workflows')
    dir = mkdtempSync(join(tmpdir(), 'acorn-workflow-tasks-'))
    const at = Date.now()
    await core.db.insert(coreSchema.workspaces).values({
      id: 'workspace-one', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at,
    })
    await core.db.insert(coreSchema.projects).values({
      id: 'project-one', name: 'Project', path: dir, workspaceId: 'workspace-one', sort: 0,
      hidden: false, vcs: 'none', defaultBranch: 'main', remoteUrl: null, githubOwner: null,
      githubName: null, githubRepoId: null, createdAt: at, updatedAt: at,
    })
    await core.db.insert(coreSchema.tasks).values({
      id: 'parent-task', title: 'Ticket batch', origin: 'local', projectId: 'project-one', branch: null,
      worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0,
      createdAt: at, updatedAt: at,
    })
  })

  afterEach(async () => {
    for (const runner of runners) runner.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    workflows.cleanup()
    core.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs the ticket map from generated and hand-authored definitions without duplicate work after restart', async () => {
    const child = await createDef(workflows.db, {
      workspaceId: 'workspace-one', projectId: 'project-one',
      def: {
        name: 'Review ticket', inputs: [{ name: 'ticket', required: true }],
        steps: [
          { name: 'approve', kind: 'gate-human' },
          { name: 'review-ticket', prompt: 'Review ${inputs.ticket}.' },
        ],
      },
    })
    const expected = ticketMap(child.id)
    const catalog: WorkflowCatalog = {
      kinds: [
        { id: 'agent', pluginId: null, describe: null },
        { id: 'gate-human', pluginId: null, describe: null },
        { id: 'workflow-map', pluginId: null, describe: null },
      ],
      policies: [],
      profiles: [{ id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true }],
      workflows: [{ ref: { source: 'database', id: child.id }, name: child.name, inputs: [{ name: 'ticket', required: true }] }],
    }
    const generated = await generateWorkflowRequest({
      request: {
        mode: 'overwrite', backendId: 'connection:fixture', description: 'Review each selected ticket.',
        workspaceId: 'workspace-one', projectId: 'project-one',
      },
      catalog,
      validation: catalogValidation(catalog),
      generateText: vi.fn(async () => ({ text: JSON.stringify(expected), providerId: 'fixture', modelId: 'fixture' })),
    })
    if (!('def' in generated)) throw new Error(generated.error)

    mkdirSync(join(dir, '.acorn', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.acorn', 'workflows', 'ticket-map.toml'), `
name = "Review selected tickets"
[[steps]]
name = "select"
after = []
prompt = "Select tickets."
schema_json = '{"type":"object"}'
[[steps]]
name = "review"
kind = "workflow-map"
after = ["select"]
item_key = "/id"
[steps.items]
step = "select"
pointer = "/tickets"
[steps.child_workflow.ref]
source = "database"
id = "${child.id}"
[steps.child_workflow.inputs.ticket]
from = "item"
pointer = "/number"
[steps.title]
template = "Review \${ticket}"
[steps.title.bindings.ticket]
from = "item"
pointer = "/number"
`)
    const handAuthored = loadWorkflowFiles(dir, null, catalogValidation(catalog)).workflows[0]
    if (!handAuthored) throw new Error('The hand-authored ticket workflow did not load.')

    const taskScope = { workspaceId: 'workspace-one', projectId: 'project-one', repoDir: dir, userDir: null }
    const definitions = [handAuthored, generated.def]
    const promptsByDefinition: string[][] = []

    for (const [definitionIndex, definition] of definitions.entries()) {
      const prompts: string[] = []
      promptsByDefinition.push(prompts)
      let dispatcher: WorkflowDispatcher
      const makeRunner = () => {
        const deps: RunnerDeps = {
          runStep: vi.fn(async (_taskId, step, options) => {
            if (step.name === 'select') {
              return succeeded('selected', { tickets })
            }
            prompts.push(options.prompt)
            return succeeded('reviewed', { ticket: options.prompt })
          }),
          writeHandoff: async () => undefined,
          assembleContext: async () => '',
          evaluatePolicy: async () => ({ pass: true }),
          failingChecks: async () => '',
          notify: vi.fn(),
          runtimeWorkflowDispatchEnabled: true,
          dispatchChildWorkflow: (request, signal) => dispatcher.dispatch(request, signal),
          dispatchChildWorkflows: (requests, signal) => dispatcher.dispatchMany(requests, signal),
        }
        const runner = new WorkflowRunner(workflows.db, deps)
        dispatcher = new WorkflowDispatcher(workflows.db, runner, makeTestCoreServices(core).tasks)
        runners.push(runner)
        return { runner, dispatcher }
      }

      const graph = await resolveWorkflowGraph(workflows.db, definition, {
        scope: taskScope, catalog: catalogValidation(catalog),
      })
      let active = makeRunner()
      const rootRunId = await active.runner.start('parent-task', graph.root, { resolvedGraph: graph })
      await vi.waitFor(async () => expect((await active.runner.run(rootRunId))?.status).toBe('gated'))
      const runsBeforeRestart = await workflows.db.select().from(workflowRuns).where(eq(workflowRuns.parentRunId, rootRunId))
      const dispatchesBeforeRestart = await workflows.db.select().from(workflowDispatches).where(eq(workflowDispatches.parentRunId, rootRunId))
      expect(runsBeforeRestart).toHaveLength(tickets.length)
      expect(dispatchesBeforeRestart).toHaveLength(tickets.length)
      expect(dispatchesBeforeRestart
        .map((dispatch) => (JSON.parse(dispatch.payloadJson) as { inputs?: Record<string, string> }).inputs)
        .sort((left, right) => (left?.ticket ?? '').localeCompare(right?.ticket ?? '')),
      ).toEqual([{ ticket: 'ACORN-42' }, { ticket: 'ACORN-43' }])
      active.runner.stop()

      active = makeRunner()
      await active.dispatcher.reconcile()
      await active.runner.reconcile()
      const childRuns = await workflows.db.select().from(workflowRuns).where(eq(workflowRuns.parentRunId, rootRunId))
      expect(childRuns).toHaveLength(tickets.length)
      expect(childRuns.map((run) => run.id).sort()).toEqual(runsBeforeRestart.map((run) => run.id).sort())
      for (const childRun of childRuns) {
        const gate = (await active.runner.steps(childRun.id)).find((step) => step.name === 'approve')
        await active.runner.resolveGate(childRun.id, gate!.id, true)
      }
      await vi.waitFor(async () => expect((await active.runner.run(rootRunId))?.status).toBe('done'))
      const dispatches = await workflows.db.select().from(workflowDispatches).where(eq(workflowDispatches.parentRunId, rootRunId))
      expect(dispatches).toHaveLength(tickets.length)
      expect(dispatches.map(({ taskId, runId }) => ({ taskId, runId })).sort((left, right) => left.runId.localeCompare(right.runId)))
        .toEqual(dispatchesBeforeRestart.map(({ taskId, runId }) => ({ taskId, runId })).sort((left, right) => left.runId.localeCompare(right.runId)))
      const childTasks = await core.db.select().from(coreSchema.tasks).where(eq(coreSchema.tasks.parentId, 'parent-task'))
      expect(childTasks).toHaveLength((definitionIndex + 1) * tickets.length)
    }

    expect(promptsByDefinition[1]).toEqual(promptsByDefinition[0])
    expect(promptsByDefinition[0]).toHaveLength(2)
    expect(promptsByDefinition[0][0]).toContain('Review ACORN-42.')
    expect(promptsByDefinition[0][1]).toContain('Review ACORN-43.')
  })
})
