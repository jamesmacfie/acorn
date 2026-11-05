import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { createPublishedDef } from '../../testkit/publishedDefinition'
import type { WorkflowValidationCatalog } from '../validation/definition'
import { cloneLaunchState, cloneLaunchWorkflows, startCloneLaunch, type CloneLaunchDeps } from './cloneLaunch'

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set(['agent']),
  policies: new Set(),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
  managedProfiles: new Set(['claude-code']),
}
const step = '[[steps]]\nid = "look"\nname = "look"\nprompt = "Look."\n'
const scan = `format_version = 1\nbaseline = "acorn-1"\nname = "Security scan"\n[[inputs]]\nname = "focus"\nschema_json = '{"type":"string"}'\nrequired = true\n${step}`
const def = (name: string) => ({
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const,
  name,
  steps: [{ id: 'only', name: 'only', prompt: 'Do it.' }],
})
const clone = { url: 'https://example.com/acme/api.git', parentDir: '/work' }

let store: TestPluginDb
let home: string
beforeEach(() => {
  store = makeTestPluginDb('workflows')
  home = mkdtempSync(join(tmpdir(), 'acorn-clone-launch-'))
  mkdirSync(join(home, '.acorn', 'workflows'), { recursive: true })
  writeFileSync(join(home, '.acorn', 'workflows', 'security-scan.toml'), scan)
})
afterEach(() => {
  store.cleanup()
  rmSync(home, { recursive: true, force: true })
})

function setup(startById: CloneLaunchDeps['starts']['startById'] = async () => ({ runId: 'run-1' })) {
  const calls = { clones: [] as unknown[], tasks: [] as string[], starts: [] as string[] }
  const deps: CloneLaunchDeps = {
    db: store.db,
    userDir: home,
    catalog: () => catalog,
    core: {
      projects: {
        clone: async (input: unknown) => {
          calls.clones.push(input)
          return { cloneId: `clone-${calls.clones.length}` }
        },
        cloneRun: async () => ({ state: 'finished', result: { ok: true, projectId: 'project-1' } }),
      },
      tasks: {
        createRoot: async (_projectId: string, _seed: unknown, taskId: string) => {
          calls.tasks.push(taskId)
          return taskId
        },
      },
    } as never,
    starts: {
      startById: async (...args) => {
        calls.starts.push(args[0])
        return startById(...args)
      },
    },
  }
  return { deps, calls }
}

const request = (overrides: Partial<Parameters<typeof startCloneLaunch>[1]> = {}) => ({
  clone,
  defId: 'user:security-scan',
  inputs: { focus: 'secrets' },
  launchId: randomUUID(),
  ...overrides,
})

const settled = async (launchId: string) => {
  for (;;) {
    const state = await cloneLaunchState(launchId, 1000)
    if (state?.stage === 'started' || state?.stage === 'failed') return state
  }
}

it('refuses a committed workflow before cloning', async () => {
  const { deps, calls } = setup()
  await expect(startCloneLaunch(deps, request({ defId: 'repo:security-scan' }))).rejects.toThrow(/committed/)
  expect(calls.clones).toEqual([])
})

it('refuses a missing required input before cloning', async () => {
  const { deps, calls } = setup()
  await expect(startCloneLaunch(deps, request({ inputs: {} }))).rejects.toThrow(/focus/)
  expect(calls.clones).toEqual([])
})

it('refuses a saved workflow from another workspace, or one bound to a project, before cloning', async () => {
  const { deps, calls } = setup()
  const other = await createPublishedDef(store.db, { workspaceId: 'w2', def: def('Elsewhere') })
  const bound = await createPublishedDef(store.db, { workspaceId: 'w1', projectId: 'p1', def: def('Bound') })
  const free = await createPublishedDef(store.db, { workspaceId: 'w1', def: def('Free') })
  const into = { ...clone, workspaceId: 'w1' }
  await expect(startCloneLaunch(deps, request({ defId: other.id, inputs: {}, clone: into }))).rejects.toThrow()
  await expect(startCloneLaunch(deps, request({ defId: bound.id, inputs: {}, clone: into }))).rejects.toThrow()
  // With no workspace named, the Node can't tell where the project lands, so no saved workflow can run.
  await expect(startCloneLaunch(deps, request({ defId: free.id, inputs: {} }))).rejects.toThrow(/workspace/)
  expect(calls.clones).toEqual([])
  expect((await cloneLaunchWorkflows(deps, 'w1')).map((entry) => entry.id).sort()).toEqual(
    [free.id, 'user:security-scan'].sort(),
  )
  expect((await cloneLaunchWorkflows(deps)).map((entry) => entry.id)).toEqual(['user:security-scan'])
})

it('clones untrusted, starts the run on a new task, and joins on a replayed launch ID', async () => {
  const { deps, calls } = setup()
  const first = request()
  await startCloneLaunch(deps, first)
  const done = await settled(first.launchId)
  expect(done).toMatchObject({ stage: 'started', projectId: 'project-1', runId: 'run-1' })
  expect(calls.clones).toEqual([{ ...clone, trusted: false }])
  expect(await startCloneLaunch(deps, first)).toEqual(done)
  expect(calls.clones).toHaveLength(1)
  expect(calls.starts).toHaveLength(1)
  await expect(startCloneLaunch(deps, { ...first, inputs: { focus: 'other' } })).rejects.toThrow(/different/)
})

it('keeps the project and task when the start fails, and retries on the same task without cloning', async () => {
  let fail = true
  const { deps, calls } = setup(async () => (fail ? { error: 'No agent is set up.' } : { runId: 'run-2' }))
  const launch = request()
  await startCloneLaunch(deps, launch)
  const failed = await settled(launch.launchId)
  expect(failed).toMatchObject({ stage: 'failed', failedAt: 'starting', error: 'No agent is set up.' })
  expect(failed.projectId).toBe('project-1')
  fail = false
  await startCloneLaunch(deps, launch)
  expect(await settled(launch.launchId)).toMatchObject({ stage: 'started', taskId: failed.taskId, runId: 'run-2' })
  expect(calls.clones).toHaveLength(1)
  expect(new Set(calls.tasks)).toEqual(new Set([failed.taskId]))
})
