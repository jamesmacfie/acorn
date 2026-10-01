import type { ParsedArgs } from './args'
import { CliError } from './error'
import { readJsonFile, rejectDoubleStdin, requestKey, requireOption, typedId } from './input'
import type { CliNode } from './node'

const base = '/v1/p/workflows'
const version = 'acorn.cli/v1'
const terminal = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
type Run = { id: string; taskId: string; name: string; status: string; error?: string | null; createdAt: number; updatedAt: number; [key: string]: unknown }
type Step = { id: string; runId: string; name: string; status: string; [key: string]: unknown }
type Definition = { id: string; source: string; name: string; inputs?: unknown[]; publishedRevision?: number | null; problems?: string[]; [key: string]: unknown }
const runPath = (id: string) => `${base}/workflows/runs/${encodeURIComponent(id)}`
const taskPath = (id: string) => `${base}/tasks/${encodeURIComponent(id)}/workflows`

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function runResource(node: CliNode, row: Run) {
  return { apiVersion: version, kind: 'WorkflowRun', nodeId: node.nodeId,
    id: row.id, taskId: row.taskId, name: row.name, status: row.status,
    posture: row.posture ?? null, error: row.error ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    rootRunId: row.rootRunId ?? null, parentRunId: row.parentRunId ?? null, parentStepId: row.parentStepId ?? null,
    rootTaskId: row.rootTaskId ?? row.taskId, parentTaskId: row.parentTaskId ?? null,
    depth: row.depth ?? 0, usage: row.usage ?? null }
}
function stepResource(node: CliNode, row: Step) {
  return { apiVersion: version, kind: 'WorkflowStep', nodeId: node.nodeId,
    id: row.id, runId: row.runId, idx: row.idx, name: row.name, stepKind: row.kind, status: row.status,
    error: row.error ?? null, parentStepId: row.parentStepId ?? null,
    sessionId: row.sessionId ?? null, agentSessionId: row.agentSessionId ?? null,
    costUsd: row.costUsd ?? null, iteration: row.iteration ?? 0,
    childRuns: Array.isArray(row.children) ? row.children.map((child) => {
      const item = child as Record<string, unknown>
      return { taskId: item.taskId, runId: item.runId, runStatus: item.runStatus,
        dispatchState: item.dispatchState }
    }) : [], createdAt: row.createdAt, updatedAt: row.updatedAt }
}
function validRun(value: unknown): value is Run {
  return object(value) && typeof value.id === 'string' && typeof value.taskId === 'string'
    && typeof value.name === 'string' && typeof value.status === 'string'
    && Number.isInteger(value.createdAt) && Number.isInteger(value.updatedAt)
}
async function readRun(node: CliNode, id: string): Promise<Run> {
  const row = await node.get(runPath(id))
  if (!validRun(row)) throw new CliError('invalid_response', 'The Workflows plugin returned an invalid run.', 1)
  return row
}
async function readSteps(node: CliNode, id: string): Promise<Step[]> {
  const rows = await node.get(`${runPath(id)}/steps`)
  if (!Array.isArray(rows) || !rows.every((row) => object(row) && typeof row.id === 'string'
    && typeof row.runId === 'string' && typeof row.name === 'string' && typeof row.kind === 'string'
    && typeof row.status === 'string' && Number.isInteger(row.idx)
    && Number.isInteger(row.createdAt) && Number.isInteger(row.updatedAt))) {
    throw new CliError('invalid_response', 'The Workflows plugin returned invalid steps.', 1)
  }
  return rows as Step[]
}
async function readStepStatuses(node: CliNode, id: string): Promise<{ steps: { id: string; status: string }[]; truncated: boolean }> {
  const result = await node.get(`${runPath(id)}/step-statuses`) as { steps?: unknown; truncated?: unknown }
  if (!Array.isArray(result?.steps) || typeof result.truncated !== 'boolean'
    || !result.steps.every((row) => object(row) && typeof row.id === 'string' && typeof row.status === 'string')) {
    throw new CliError('invalid_response', 'The Workflows plugin returned invalid step statuses.', 1)
  }
  return result as { steps: { id: string; status: string }[]; truncated: boolean }
}
function timeout(value: string | undefined): number {
  if (!value) return 300_000
  const match = /^(\d+)(s|m|h)?$/.exec(value)
  if (!match) throw new CliError('usage', '--timeout must be seconds or a duration such as 30m or 1h.', 2)
  const ms = Number(match[1]) * ({ s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? 's'] ?? 1000)
  if (!Number.isSafeInteger(ms) || ms > 86_400_000) throw new CliError('usage', '--timeout must be at most 24h.', 2)
  return ms
}
function waitMet(run: Run, steps: { status: string }[], until: string): boolean {
  if (until === 'finished') return terminal.has(run.status)
  return run.status === 'gated' || run.status === 'safety-rail' || run.status === 'failed'
    || run.status === 'completed-with-failures' || steps.some((step) => step.status === 'waiting-gate' || step.status === 'safety-rail')
}
async function wait(node: CliNode, args: ParsedArgs, id: string) {
  const until = args.options.until ?? 'finished'
  const maxMs = timeout(args.options.timeout)
  const deadline = Date.now() + maxMs
  while (true) {
    // Run and steps are durable reads; notices, when available, can only shorten the interval.
    const run = await readRun(node, id)
    const status = await readStepStatuses(node, id)
    const resource = { ...runResource(node, run), stepStatuses: status.steps, stepsTruncated: status.truncated }
    if (waitMet(run, status.steps, until)) {
      if (args.options.check === 'true' && terminal.has(run.status) && run.status !== 'done') {
        throw new CliError('workflow_failed', `Workflow run ${id} finished ${run.status}.`, 6, undefined, false, resource)
      }
      return resource
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new CliError('wait_timeout', `Workflow run ${id} did not reach ${until} within ${maxMs / 1000} seconds.`, 5, undefined, true, resource)
    await (node.waitForHint?.(id, Math.min(2000, remaining)) ?? new Promise((resolve) => setTimeout(resolve, Math.min(2000, remaining))))
  }
}

async function mergedRuns(node: CliNode, workspaceId?: string) {
  const result = await node.get('/v1/core/runs') as { runs?: unknown; failed?: unknown }
  if (!Array.isArray(result?.runs) || !Array.isArray(result.failed) || !result.failed.every((id) => typeof id === 'string')) {
    throw new CliError('invalid_response', 'The Node returned an invalid merged run list.', 1)
  }
  if (!result.runs.every((row) => object(row) && typeof row.id === 'string'
    && typeof row.pluginId === 'string' && typeof row.title === 'string'
    && typeof row.status === 'string' && Number.isInteger(row.startedAt))) {
    throw new CliError('invalid_response', 'The Node returned an invalid run summary.', 1)
  }
  let runs = result.runs as Array<Record<string, unknown>>
  if (workspaceId) {
    const [projects, active, archived] = await Promise.all([
      node.get('/v1/core/projects') as Promise<{ projects: { id: string; workspaceId: string }[] }>,
      node.get('/v1/core/tasks') as Promise<{ id: string; projectId: string }[]>,
      node.get('/v1/core/tasks?status=archived') as Promise<{ id: string; projectId: string }[]>,
    ])
    if (!Array.isArray(projects?.projects) || !Array.isArray(active) || !Array.isArray(archived)) {
      throw new CliError('invalid_response', 'The Node returned invalid workspace membership.', 1)
    }
    const projectIds = new Set(projects.projects.filter((row) => row.workspaceId === workspaceId).map((row) => row.id))
    const taskIds = new Set([...active, ...archived].filter((row) => projectIds.has(row.projectId)).map((row) => row.id))
    runs = runs.filter((row) => typeof row.taskId === 'string' && taskIds.has(row.taskId))
  }
  return { apiVersion: version, kind: 'RunList', nodeId: node.nodeId, workspaceId: workspaceId ?? null,
    runs: runs.map((row) => ({ apiVersion: version, kind: 'RunSummary', nodeId: node.nodeId,
      id: row.id, pluginId: row.pluginId, title: row.title, status: row.status,
      startedAt: row.startedAt, endedAt: row.endedAt ?? null, taskId: row.taskId ?? null,
      costUsd: row.costUsd ?? null, detail: row.detail ?? null })),
    failedSources: result.failed, complete: false, sourceLimit: 200, truncated: 'unknown',
    note: 'Recent runs only. Use workflow run list --task or agent list for owner history.' }
}

export async function runWorkflowCommand(node: CliNode, args: ParsedArgs): Promise<unknown> {
  const [subject, verb, action, rawId] = args.positionals
  const o = args.options
  if (subject === 'run') {
    rejectDoubleStdin([o.workspace])
    const workspaceId = o.workspace ? await typedId(o.workspace, 'Workspace', node, 'workspace') : undefined
    return mergedRuns(node, workspaceId)
  }
  if (verb === 'list') {
    const taskId = await typedId(o.task, 'Task', node, 'task')
    const result = await node.get(taskPath(taskId)) as { workflows?: unknown; errors?: unknown }
    if (!Array.isArray(result?.workflows) || !Array.isArray(result.errors)) throw new CliError('invalid_response', 'The Workflows plugin returned an invalid definition list.', 1)
    const errors = result.errors.filter((error): error is { source: string; message: string } => object(error) && typeof error.source === 'string' && typeof error.message === 'string')
    const definitions = (result.workflows as Definition[]).map((row) => {
      if (!row || typeof row.id !== 'string' || typeof row.source !== 'string' || typeof row.name !== 'string'
        || (row.inputs !== undefined && !Array.isArray(row.inputs))) throw new CliError('invalid_response', 'The Workflows plugin returned an invalid definition.', 1)
      const id = row.source === 'database' ? row.id : `${row.source}:${row.id}`
      const problems = [...(row.problems ?? []), ...errors.filter((error) => error.source === id).map((error) => error.message)]
      return { apiVersion: version, kind: 'WorkflowDefinition', nodeId: node.nodeId, id, taskId,
        name: row.name, source: row.source, publishedRevision: row.publishedRevision ?? null,
        inputs: row.inputs ?? [], valid: problems.length === 0, problems, runnable: problems.length === 0 }
    })
    for (const source of new Set(errors.map((error) => error.source))) {
      const match = /^(repo|user):(.+)$/.exec(source)
      if (!match || definitions.some((definition) => definition.id === source)) continue
      definitions.push({ apiVersion: version, kind: 'WorkflowDefinition', nodeId: node.nodeId, id: source, taskId,
        name: match[2]!, source: match[1]!, publishedRevision: null, inputs: [], valid: false,
        problems: errors.filter((error) => error.source === source).map((error) => error.message), runnable: false })
    }
    return { apiVersion: version, kind: 'WorkflowDefinitionList', nodeId: node.nodeId, taskId, definitions, errors }
  }
  if (verb === 'start') {
    rejectDoubleStdin([o.task, o['inputs-file']])
    const taskId = await typedId(o.task, 'Task', node, 'task')
    const definition = requireOption(o, 'definition')
    const inputs = o['inputs-file'] ? await readJsonFile(o['inputs-file']) : undefined
    if (inputs !== undefined && !object(inputs)) throw new CliError('invalid_input', 'Workflow inputs must be a JSON object.', 2)
    const key = requestKey(o['request-id'])
    let result: { runId?: string; error?: string }
    try { result = await node.mutate('POST', taskPath(taskId), { defId: definition, ...(inputs === undefined ? {} : { inputs }) }, key) as typeof result }
    catch (error) {
      if (error instanceof CliError && error.exitCode === 7) {
        throw new CliError('ambiguous_workflow_start', `The start response is uncertain. Inspect workflow run list --task ${taskId} and its runs before any retry. Request ID: ${key}. ${error.message}`, 7, key, false)
      }
      throw error
    }
    if (result?.error) throw new CliError(result.error === 'needs-trust' ? 'needs_trust' : 'workflow_start_refused', result.error, 4, key, false)
    if (!result?.runId) throw new CliError('ambiguous_workflow_start', `The Node did not confirm a run ID. Inspect workflow run list --task ${taskId} before retrying. Request ID: ${key}.`, 7, key, false)
    // Acknowledgement is durable. A failed detail read must still return the ID to the caller.
    try { return runResource(node, await readRun(node, result.runId)) }
    catch (error) { throw new CliError('partial_workflow_start', `Workflow run ${result.runId} started, but detail could not be read. Inspect workflow run show ${result.runId}.`, 7, key, true,
      { apiVersion: version, kind: 'WorkflowRunAck', nodeId: node.nodeId, id: result.runId, taskId, status: 'unconfirmed' }) }
  }
  if (verb === 'run') {
    if (action === 'list') {
      const taskId = await typedId(o.task, 'Task', node, 'task')
      const rows = await node.get(`${taskPath(taskId)}/runs`)
      if (!Array.isArray(rows) || !rows.every(validRun)) throw new CliError('invalid_response', 'The Workflows plugin returned an invalid run list.', 1)
      return rows.map((row) => runResource(node, row))
    }
    const id = rawId === '-' ? await typedId(rawId, 'WorkflowRun', node, 'run') : rawId!
    if (action === 'show') return runResource(node, await readRun(node, id))
    if (action === 'steps') return (await readSteps(node, id)).map((row) => stepResource(node, row))
    if (action === 'wait') return wait(node, args, id)
  }
  throw new CliError('usage', 'Unknown workflow command.', 2)
}
