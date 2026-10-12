import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Extension, ExtensionPointId } from '@acorn/plugin-api/node'
import { makeTestCoreServices, makeTestDb, makeTestPluginDb, schema } from '@acorn/plugin-api/testkit'
import { WORKFLOW_POLICY } from '../../contract/extensions'
import { readPolicyWait } from '../../shared/policyWait'
import type { PolicyVerdict } from '../../shared/workflowContracts'
import { readWorkflowCheckoutActivity } from './checkoutActivity'
import { WorkflowRunner } from './runner'

// Core's real checkout admission over a real runner: the Git pane's write is admitted while a polling
// gate sleeps, and refused while a poll runs (docs/workflows/polling-gates.md).

let directory = ''
let core: ReturnType<typeof makeTestDb>
let workflows: ReturnType<typeof makeTestPluginDb>
let runner: WorkflowRunner | undefined

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'acorn-checkout-release-'))
  core = makeTestDb()
  workflows = makeTestPluginDb('workflows')
  const at = Date.now()
  await core.db
    .insert(schema.workspaces)
    .values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
  await core.db.insert(schema.projects).values({
    id: 'project',
    name: 'project',
    path: directory,
    workspaceId: 'ws',
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: null,
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: at,
    updatedAt: at,
  })
  await core.db.insert(schema.tasks).values({
    id: 'task',
    title: 'Waiting task',
    origin: 'local',
    projectId: 'project',
    branch: null,
    worktreePath: null,
    pullNumber: null,
    status: 'active',
    sort: 0,
    createdAt: at,
    updatedAt: at,
  })
})

afterEach(() => {
  runner?.stop()
  workflows.cleanup()
  core.cleanup()
  rmSync(directory, { recursive: true, force: true })
})

it('lets the Git pane write while a polling gate sleeps, and not while it polls', async () => {
  const services = makeTestCoreServices(core)
  services.checkoutAdmission.registerOwner('turns', async () => [])
  services.checkoutAdmission.registerOwner('runs', (taskIds) => readWorkflowCheckoutActivity(workflows.db, taskIds))

  // The first poll answers at once. The second waits until the test lets it go.
  let releasePoll!: (answer: PolicyVerdict) => void
  let wakeUp!: () => void
  const evaluate = vi
    .fn<() => Promise<PolicyVerdict>>()
    .mockResolvedValueOnce({ verdict: 'wait', detail: 'Not yet' })
    .mockImplementationOnce(() => new Promise((resolve) => (releasePoll = resolve)))
  const policy = { evaluate, describe: { label: 'Test', description: 'Test.', icon: 'x', fields: [] } }
  runner = new WorkflowRunner(
    workflows.db,
    {
      runStep: async () => {
        throw new Error('No agent step runs here.')
      },
      writeHandoff: async () => {},
      assembleContext: async () => '',
      notify: () => {},
      admitWork: (taskId, action) => services.checkoutAdmission.admitWork(taskId, action),
      sleep: () => new Promise<void>((resolve) => (wakeUp = resolve)),
    },
    {
      handlers: <T>(point: ExtensionPointId<T>) =>
        (point === WORKFLOW_POLICY
          ? [{ id: 'test:ci', pluginId: 'test', order: 0, value: policy }]
          : []) as Extension<T>[],
    },
  )
  const runId = await runner.start('task', {
    baseline: 'acorn-1',
    formatVersion: 1,
    name: 'Wait',
    steps: [{ id: 'await', name: 'await', kind: 'gate-policy', policy: 'test:ci', timeoutMs: 3_600_000 }],
  })
  const waitState = async () => readPolicyWait((await runner!.steps(runId))[0]!.inputsJson)?.state

  await vi.waitFor(async () => expect(await waitState()).toBe('sleeping'))
  expect(await services.checkoutAdmission.write('task', async () => 'committed')).toBe('committed')

  wakeUp()
  await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2))
  expect(await waitState()).toBe('polling')
  await expect(services.checkoutAdmission.write('task', async () => 'committed')).rejects.toMatchObject({
    code: 'checkout_busy',
  })

  releasePoll({ verdict: 'pass' })
  await vi.waitFor(async () => expect((await runner!.run(runId))?.status).toBe('done'))
})
