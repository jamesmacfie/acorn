import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from './args'
import { runCommand } from './commands'
import { CliError } from './error'
import type { CliNode } from './node'

const temporary: string[] = []
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function jsonFile(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-workflow-'))
  temporary.push(dir)
  const file = join(dir, 'inputs.json')
  writeFileSync(file, JSON.stringify(value))
  return file
}
function node(get: (path: string) => unknown, mutate: CliNode['mutate'] = async () => { throw new Error('unexpected write') }): CliNode {
  return { nodeId: 'n1', endpoint: 'https://node.test', async get(path) { return get(path) }, mutate, close() {} }
}
const run = { id: 'r1', taskId: 't1', name: 'Review', status: 'done', createdAt: 1, updatedAt: 2 }

describe('workflow CLI', () => {
  it('keeps distinct definition sources, revision, and validation diagnostics', async () => {
    const client = node((path) => {
      expect(path).toBe('/v1/p/workflows/tasks/t1/workflows')
      return { workflows: [
        { id: 'review', name: 'Repo', source: 'repo', inputs: [{ name: 'ticket', required: true }] },
        { id: 'other', name: 'User', source: 'user' },
        { id: 'db1', name: 'Saved', source: 'database', publishedRevision: 3 },
      ], errors: [{ source: 'repo:bad', message: 'unknown step kind' }] }
    })
    const result = await runCommand(client, parseCliArgs(['workflow', 'list', '--task', 't1'])) as Record<string, unknown>
    expect(result).toMatchObject({ kind: 'WorkflowDefinitionList', errors: [{ source: 'repo:bad' }], definitions: [
      { id: 'repo:review', source: 'repo', valid: true },
      { id: 'user:other', source: 'user' },
      { id: 'db1', source: 'database', publishedRevision: 3 },
      { id: 'repo:bad', source: 'repo', valid: false, runnable: false, problems: ['unknown step kind'] },
    ] })
  })

  it('sends typed inputs and returns a durable run resource', async () => {
    const inputs = { n: 12, b: false, a: [null, { child: true }], nil: null }
    const file = jsonFile(inputs)
    const mutate = vi.fn(async (_method, path, body) => {
      expect(path).toBe('/v1/p/workflows/tasks/t1/workflows')
      expect(body).toEqual({ defId: 'repo:review', inputs })
      return { runId: 'r1' }
    })
    const client = node((path) => { expect(path).toBe('/v1/p/workflows/workflows/runs/r1'); return run }, mutate)
    expect(await runCommand(client, parseCliArgs(['workflow', 'start', '--task', 't1', '--definition', 'repo:review', '--inputs-file', file]))).toMatchObject({ kind: 'WorkflowRun', id: 'r1', status: 'done' })
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('surfaces Node trust and validation refusals without hiding their reason', async () => {
    const client = node(() => { throw new Error('unexpected read') }, async () => ({ error: 'needs-trust' }))
    await expect(runCommand(client, parseCliArgs(['workflow', 'start', '--task', 't1', '--definition', 'repo:review']))).rejects.toMatchObject({ code: 'needs_trust', exitCode: 4 })
    const invalid = node(() => { throw new Error('unexpected read') }, async () => ({ error: "Missing required input 'ticket'." }))
    await expect(runCommand(invalid, parseCliArgs(['workflow', 'start', '--task', 't1', '--definition', 'repo:review']))).rejects.toMatchObject({ code: 'workflow_start_refused', message: "Missing required input 'ticket'." })
  })

  it('refuses invalid inputs and double stdin before a write', async () => {
    const mutate = vi.fn()
    const client = node(() => null, mutate)
    await expect(runCommand(client, parseCliArgs(['workflow', 'start', '--task', '-', '--definition', 'repo:review', '--inputs-file', '-']))).rejects.toMatchObject({ code: 'usage' })
    await expect(runCommand(client, parseCliArgs(['workflow', 'start', '--task', 't1', '--definition', 'repo:review', '--inputs-file', jsonFile([1, 2])]))).rejects.toMatchObject({ code: 'invalid_input' })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports an uncertain response with a safe task-scoped inspection path and does not retry', async () => {
    // Simulates a crash after the domain inserted a run but before the replay response was saved.
    const saved = [] as typeof run[]
    const mutate = vi.fn(async () => { saved.push(run); throw new CliError('ambiguous_mutation', 'Connection lost after write.', 7) })
    const client = node(() => null, mutate)
    await expect(runCommand(client, parseCliArgs(['workflow', 'start', '--task', 't1', '--definition', 'repo:review', '--request-id', '11111111-1111-4111-8111-111111111111']))).rejects.toMatchObject({
      code: 'ambiguous_workflow_start', exitCode: 7, retryable: false,
      message: expect.stringContaining('workflow run list --task t1'),
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    const freshClient = node((path) => {
      expect(path).toBe('/v1/p/workflows/tasks/t1/workflows/runs')
      return saved
    })
    expect(await runCommand(freshClient, parseCliArgs(['workflow', 'run', 'list', '--task', 't1']))).toMatchObject([{ id: 'r1' }])
  })

  it('shows run and steps directly and waits on durable terminal and attention states', async () => {
    let status = 'running'
    const client = node((path) => path.endsWith('/step-statuses')
      ? { steps: [{ id: 's1', status: status === 'gated' ? 'waiting-gate' : 'done' }], truncated: false }
      : path.endsWith('/steps')
        ? [{ id: 's1', runId: 'r1', idx: 0, name: 'Gate', kind: 'gate', status: status === 'gated' ? 'waiting-gate' : 'done', createdAt: 1, updatedAt: 2 }]
        : { ...run, status })
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'show', 'r1']))).toMatchObject({ kind: 'WorkflowRun', id: 'r1' })
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'steps', 'r1']))).toMatchObject([{ kind: 'WorkflowStep', id: 's1' }])
    status = 'gated'
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'wait', 'r1', '--until', 'attention', '--timeout', '0']))).toMatchObject({ status: 'gated', stepStatuses: [{ status: 'waiting-gate' }] })
    status = 'failed'
    await expect(runCommand(client, parseCliArgs(['workflow', 'run', 'wait', 'r1', '--until', 'finished', '--check']))).rejects.toMatchObject({ exitCode: 6, partial: { status: 'failed' } })
    status = 'cancelled'
    await expect(runCommand(client, parseCliArgs(['workflow', 'run', 'wait', 'r1', '--check']))).rejects.toMatchObject({ exitCode: 6, partial: { status: 'cancelled' } })
    status = 'done'
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'wait', 'r1', '--check']))).toMatchObject({ status: 'done' })
  })

  it('does not let Node response extras replace CLI resource identity', async () => {
    const client = node((path) => path.endsWith('/steps')
      ? [{ id: 's1', runId: 'r1', idx: 0, name: 'Step', status: 'done', kind: 'agent', createdAt: 1, updatedAt: 2, nodeId: 'forged', apiVersion: 'other' }]
      : { ...run, kind: 'forged', nodeId: 'forged', apiVersion: 'other' })
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'show', 'r1']))).toMatchObject({ apiVersion: 'acorn.cli/v1', kind: 'WorkflowRun', nodeId: 'n1' })
    expect(await runCommand(client, parseCliArgs(['workflow', 'run', 'steps', 'r1']))).toMatchObject([{ apiVersion: 'acorn.cli/v1', kind: 'WorkflowStep', nodeId: 'n1', stepKind: 'agent' }])
    const merged = node(() => ({ runs: [{ id: 'r1', title: 'Review', pluginId: 'workflows', status: 'done', startedAt: 1, kind: 'forged', nodeId: 'forged' }], failed: [] }))
    expect(await runCommand(merged, parseCliArgs(['run', 'list']))).toMatchObject({ runs: [{ apiVersion: 'acorn.cli/v1', kind: 'RunSummary', nodeId: 'n1' }] })
  })

  it('marks merged summaries incomplete and names a failed source', async () => {
    const client = node((path) => { expect(path).toBe('/v1/core/runs'); return { runs: [{ id: 'r1', pluginId: 'workflows', title: 'Review', startedAt: 1, taskId: 't1', status: 'done' }], failed: ['agents'] } })
    expect(await runCommand(client, parseCliArgs(['run', 'list']))).toMatchObject({ kind: 'RunList', complete: false, sourceLimit: 200, truncated: 'unknown', failedSources: ['agents'], runs: [{ kind: 'RunSummary', pluginId: 'workflows' }] })
  })

  it('filters task-owned merged runs by workspace and leaves taskless schedules out', async () => {
    const client = node((path) => ({
      '/v1/core/runs': { runs: [
        { id: 'r1', pluginId: 'workflows', title: 'One', startedAt: 1, taskId: 't1', status: 'done' },
        { id: 'r2', pluginId: 'workflows', title: 'Two', startedAt: 2, taskId: 't2', status: 'done' },
        { id: 's1', pluginId: 'schedules', title: 'Schedule', startedAt: 3, taskId: null, status: 'done' },
      ], failed: [] },
      '/v1/core/projects': { projects: [{ id: 'p1', workspaceId: 'w1' }, { id: 'p2', workspaceId: 'w2' }] },
      '/v1/core/tasks': [{ id: 't1', projectId: 'p1' }],
      '/v1/core/tasks?status=archived': [{ id: 't2', projectId: 'p2' }],
    } as Record<string, unknown>)[path])
    expect(await runCommand(client, parseCliArgs(['run', 'list', '--workspace', 'w1']))).toMatchObject({ workspaceId: 'w1', runs: [{ id: 'r1' }] })
  })
})
