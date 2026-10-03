import { taskScriptAcceptable, taskScriptLogsSchema, taskScriptsRoute, taskScriptsStatusSchema, taskScriptWaitSchema } from '@acorn/protocol/taskScripts.ts'
import type { ParsedArgs } from './args'
import { CliError } from './error'
import { typedId } from './input'
import type { CliNode } from './node'

export function validateScriptCommand(args: ParsedArgs): void {
  const action = args.positionals[2]
  if (!action || !['status', 'wait', 'logs'].includes(action) || args.positionals.length < 3 || args.positionals.length > 4) throw new CliError('usage', 'Use task scripts status|wait|logs [TASK_ID].', 2)
  const allowed = new Set(['node', 'output', 'no-header', 'help', ...(action === 'status' ? [] : ['phase', 'attempt', ...(action === 'wait' ? ['timeout', 'check'] : ['tail', 'max-bytes'])])])
  for (const option of Object.keys(args.options)) if (!allowed.has(option)) throw new CliError('usage', `--${option} is not supported by task scripts ${action}.`, 2)
  if (action !== 'status' && !['setup', 'teardown'].includes(args.options.phase ?? '')) throw new CliError('usage', '--phase setup|teardown is required.', 2)
  if (args.output === 'jsonl') throw new CliError('usage', 'Task scripts support text or JSON output.', 2)
  if (action === 'wait') duration(args.options.timeout)
  if (action === 'logs') { integer(args.options.tail, 'tail', 100, 1, 1000); integer(args.options['max-bytes'], 'max-bytes', 32768, 1, 32768) }
}
function duration(value?: string): number {
  if (!value) return 300_000
  const match = /^(\d+)(s|m|h)?$/.exec(value)
  const ms = match ? Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000 }[match[2] ?? 's'] ?? 1000) : NaN
  if (!Number.isSafeInteger(ms) || ms > 86400000) throw new CliError('usage', '--timeout must be seconds or a duration up to 24h, such as 5m.', 2)
  return ms
}
function integer(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new CliError('usage', `--${name} must be an integer from ${min} to ${max}.`, 2)
  return n
}
export async function runScriptCommand(node: CliNode, args: ParsedArgs): Promise<unknown> {
  const action = args.positionals[2]!
  const rawId = args.positionals[3] ?? node.taskId
  if (!rawId) throw new CliError('usage', 'TASK_ID is required outside an Acorn task launch.', 2)
  const id = await typedId(rawId, 'Task', node, 'task')
  if (node.taskId && id !== node.taskId) throw new CliError('task_scope', 'TASK_ID conflicts with the authoritative launch task.', 4)
  const path = taskScriptsRoute(id)
  const resource = (kind: string, data: unknown) => ({ apiVersion: 'acorn.cli/v1', kind, nodeId: node.nodeId, ...(data as object) })
  if (action === 'status') return resource('TaskScripts', taskScriptsStatusSchema.parse(await node.get(path)))
  const selection = { phase: args.options.phase!, ...(args.options.attempt ? { attemptId: args.options.attempt } : {}) }
  if (action === 'logs') {
    const query = new URLSearchParams({ ...selection, tailLines: String(integer(args.options.tail, 'tail', 100, 1, 1000)), maxBytes: String(integer(args.options['max-bytes'], 'max-bytes', 32768, 1, 32768)) })
    return resource('TaskScriptLogs', taskScriptLogsSchema.parse(await node.get(`${path}/logs?${query}`)))
  }
  const deadline = Date.now() + duration(args.options.timeout)
  const controller = new AbortController()
  const stop = () => controller.abort(new DOMException('Local wait stopped', 'AbortError'))
  process.on('SIGINT', stop)
  // First call selects once; every subsequent call uses the returned attempt identity.
  let attemptId = selection.attemptId
  let generation: number | undefined
  let last: unknown
  try {
    while (true) {
      const remaining = Math.max(0, deadline - Date.now())
      const query = new URLSearchParams({ phase: selection.phase, ...(attemptId ? { attemptId } : {}), timeoutMs: String(Math.min(remaining, 30000)) })
      const result = taskScriptWaitSchema.parse(await node.get(`${path}/wait?${query}`, controller.signal))
      last = resource('TaskScriptWait', result)
      if (generation !== undefined && result.snapshot.generation !== generation) throw new CliError('script_changed', 'The script generation changed while waiting.', 6, undefined, false, last)
      if (result.matched || result.reason !== 'timeout') {
        if (args.options.check === 'true' && (!result.matched || !taskScriptAcceptable(result.snapshot))) throw new CliError('script_failed', `Task ${id} ${selection.phase}: ${result.snapshot.state} (${result.snapshot.reason}).`, 6, undefined, false, last)
        return last
      }
      attemptId ??= result.snapshot.attemptId ?? undefined
      generation ??= result.snapshot.generation
      if (Date.now() >= deadline) throw new CliError('wait_timeout', `Task ${id} ${selection.phase} wait timed out.`, 5, undefined, true, last)
    }
  } catch (error) {
    if (controller.signal.aborted) throw new CliError('wait_cancelled', 'Local wait stopped; the script continues on the Node.', 130, undefined, false, last)
    throw error
  } finally { process.off('SIGINT', stop) }
}
