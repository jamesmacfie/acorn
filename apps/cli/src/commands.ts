import { runScriptCommand, validateScriptCommand } from './scriptCommands'
import type { ArchivedTask, NodePluginState, Project, ProjectsResponse, Task, Workspace } from '@acorn/protocol/api.ts'
import type { CliNode } from './node'
import type { ParsedArgs } from './args'
import { CliError } from './error'
import { nodeResource, pluginResources, projectResource, taskResource, workspaceResource } from './projection'
import { runCoreWrite } from './coreWrites'
import { runAgentCommand } from './agentCommands'
import { runWorkflowCommand } from './workflowCommands'
import { runPluginCommand } from './pluginCommands'

const requiredId = (id: string | undefined): string => {
  if (!id) throw new CliError('usage', 'This command needs an ID.', 2)
  return id
}
const found = <T>(value: T | undefined, id: string): T => {
  if (value === undefined) throw new CliError('not_found', `No resource has ID ${id}.`, 4)
  return value
}
const unexpected = (): never => { throw new CliError('invalid_response', 'The Node returned an unexpected response shape.', 1) }

export function validateCommand(args: ParsedArgs): void {
  const [subject, verb, id, , overflow] = args.positionals
  if (subject === 'task' && verb === 'scripts') { validateScriptCommand(args); return }
  if (subject === 'plugin' && verb !== 'list') {
    if (!verb || !id || overflow || args.positionals.length !== 3) throw new CliError('usage', 'Use plugin ID commands or plugin ID COMMAND.', 2)
    const allowed = new Set(['node', 'output', 'no-header', 'help', ...(id === 'commands' ? [] : ['input-file', 'request-id'])])
    for (const option of Object.keys(args.options)) if (!allowed.has(option)) throw new CliError('usage', `--${option} is not supported here.`, 2)
    return
  }
  if (overflow) throw new CliError('usage', 'Too many arguments.', 2)
  if (subject === 'workflow' && verb === 'run') {
    const action = id
    if (!action || !['list', 'show', 'steps', 'wait'].includes(action)) throw new CliError('usage', 'workflow run needs list, show, steps, or wait.', 2)
    if (args.positionals.length !== (action === 'list' ? 3 : 4)) throw new CliError('usage', `workflow run ${action} needs ${action === 'list' ? '--task ID' : 'a run ID'}.`, 2)
    const allowed = new Set(['node', 'output', 'no-header', 'help', ...(action === 'list' ? ['task'] : action === 'wait' ? ['until', 'timeout', 'check'] : [])])
    for (const option of Object.keys(args.options)) if (!allowed.has(option)) throw new CliError('usage', `--${option} is not supported by workflow run ${action}.`, 2)
    if (action === 'list' && !args.options.task) throw new CliError('usage', '--task is required.', 2)
    if (action === 'wait' && args.options.until && !['finished', 'attention'].includes(args.options.until)) throw new CliError('usage', '--until must be finished or attention.', 2)
    if (args.output === 'jsonl') throw new CliError('usage', 'JSON Lines is for agent events.', 2)
    return
  }
  const grammar: Record<string, Record<string, { count: number; options?: string[] }>> = {
    node: { info: { count: 2 }, start: { count: 2, options: ['background'] }, status: { count: 2 }, stop: { count: 2, options: ['force'] } },
    workspace: { list: { count: 2 }, show: { count: 3 }, create: { count: 2, options: ['name', 'request-id'] }, rename: { count: 3, options: ['name', 'request-id'] }, remove: { count: 3, options: ['request-id'] }, 'external-projects': { count: 4, options: ['file', 'request-id'] } },
    project: { list: { count: 2, options: ['workspace', 'include-hidden'] }, show: { count: 3 }, add: { count: 2, options: ['workspace', 'path', 'name', 'request-id'] }, rename: { count: 3, options: ['name', 'request-id'] }, move: { count: 3, options: ['workspace', 'request-id'] }, hide: { count: 3, options: ['request-id'] }, unhide: { count: 3, options: ['request-id'] }, detect: { count: 3, options: ['request-id'] }, remove: { count: 3, options: ['request-id'] }, config: { count: 4, options: ['patch-file', 'request-id'] } },
    task: { list: { count: 2, options: ['project', 'status'] }, show: { count: 3 }, create: { count: 2, options: ['project', 'title', 'branch', 'base', 'skip-setup', 'request-id'] } },
    agent: { providers: { count: 2 }, list: { count: 2, options: ['task', 'workspace', 'limit'] }, show: { count: 3 }, start: { count: 2, options: ['task', 'provider', 'profile', 'prompt', 'prompt-file', 'request-id'] }, send: { count: 3, options: ['prompt', 'prompt-file', 'request-id'] }, events: { count: 3, options: ['after-seq', 'limit', 'follow'] }, wait: { count: 3, options: ['until', 'timeout', 'check'] } },
    workflow: { list: { count: 2, options: ['task'] }, start: { count: 2, options: ['task', 'definition', 'inputs-file', 'request-id'] } },
    run: { list: { count: 2, options: ['workspace'] } },
    plugin: { list: { count: 2 } },
  }
  const spec = subject && verb ? grammar[subject]?.[verb] : undefined
  if (!spec) throw new CliError('usage', 'Unknown command. Run acorn --help.', 2)
  if (args.positionals.length !== spec.count) throw new CliError('usage', `${subject} ${verb} needs ${spec.count - 2} positional argument${spec.count === 3 ? '' : 's'}.`, 2)
  if (subject === 'workspace' && verb === 'external-projects' && !['list', 'replace'].includes(id ?? '')) throw new CliError('usage', 'workspace external-projects needs list or replace.', 2)
  if (subject === 'project' && verb === 'config' && !['show', 'set'].includes(id ?? '')) throw new CliError('usage', 'project config needs show or set.', 2)
  if (subject === 'workspace' && verb === 'external-projects' && id === 'replace' && !args.options.file) throw new CliError('usage', '--file is required.', 2)
  if (subject === 'project' && verb === 'config' && id === 'set' && !args.options['patch-file']) throw new CliError('usage', '--patch-file is required.', 2)
  if (subject === 'agent' && verb === 'list' && args.options.task && args.options.workspace) throw new CliError('usage', 'Use either --task or --workspace.', 2)
  if (subject === 'agent' && ['start', 'send'].includes(verb) && (!!args.options.prompt === !!args.options['prompt-file'])) throw new CliError('usage', 'Provide exactly one of --prompt or --prompt-file.', 2)
  if (subject === 'agent' && verb === 'wait' && args.options.until && !['ready', 'attention', 'turn-completed', 'stopped'].includes(args.options.until)) throw new CliError('usage', 'Invalid --until value.', 2)
  if (subject === 'agent' && verb === 'events' && args.options.follow && args.output !== 'jsonl') throw new CliError('usage', 'agent events --follow requires --output jsonl.', 2)
  if (subject === 'workflow' && !args.options.task) throw new CliError('usage', '--task is required.', 2)
  if (subject === 'workflow' && verb === 'start' && !args.options.definition) throw new CliError('usage', '--definition is required.', 2)
  if (subject !== 'agent' || verb !== 'events') {
    if (args.output === 'jsonl' && subject !== 'plugin') throw new CliError('usage', 'JSON Lines is for agent events and plugin command results.', 2)
  }
  const allowed = new Set(['node', 'output', 'no-header', 'help', ...(spec.options ?? [])])
  if (subject === 'node' && verb !== 'info') {
    if (args.node) throw new CliError('usage', 'Node service commands act on the local data root; omit --node.', 2)
    if (verb === 'start') {
      if (!args.options.background) throw new CliError('usage', 'node start requires --background.', 2)
    }
  }
  for (const option of Object.keys(args.options)) {
    if (!allowed.has(option)) throw new CliError('usage', `--${option} is not supported by ${subject} ${verb ?? ''}.`, 2)
  }
  if (args.options.status && !['active', 'archived', 'all'].includes(args.options.status)) {
    throw new CliError('usage', '--status must be active, archived, or all.', 2)
  }
}

export async function runCommand(node: CliNode, args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] === 'task' && args.positionals[1] === 'scripts') return runScriptCommand(node, args)
  validateCommand(args)
  const [subject, verb, id] = args.positionals
  if (subject === 'agent') return runAgentCommand(node, args)
  if (subject === 'plugin' && verb !== 'list') return runPluginCommand(node, args)
  if (subject === 'workflow' || subject === 'run') return runWorkflowCommand(node, args)
  if ((subject === 'workspace' && !['list', 'show'].includes(verb!))
    || (subject === 'project' && !['list', 'show'].includes(verb!))
    || (subject === 'task' && verb === 'create')) return runCoreWrite(node, args)
  if (subject === 'node' && verb === 'info' && !id) {
    const info = await node.get('/v1/node') as { protocolVersion: number; baseline: string; endpoint?: string }
    if (typeof info?.protocolVersion !== 'number' || typeof info.baseline !== 'string') return unexpected()
    return nodeResource(node.nodeId, { ...info, endpoint: node.endpoint })
  }
  if (subject === 'workspace') {
    const rows = await node.get('/v1/core/workspaces')
    if (!Array.isArray(rows)) return unexpected()
    const resources = (rows as Workspace[]).map((row) => workspaceResource(node.nodeId, row))
    return verb === 'list' ? resources : found(resources.find((row) => row.id === id), id!)
  }
  if (subject === 'project') {
    const rows = verb === 'show' ? [await node.get(`/v1/core/projects/${encodeURIComponent(requiredId(id))}`) as Project]
      : (await node.get('/v1/core/projects') as ProjectsResponse).projects
    if (!Array.isArray(rows)) return unexpected()
    const resources = rows.map((row) => projectResource(node.nodeId, row))
    return verb === 'show' ? resources[0] : resources.filter((row) => (!args.options.workspace || row.workspaceId === args.options.workspace) && (args.output === 'json' || args.options['include-hidden'] || !row.hidden))
  }
  if (subject === 'task') {
    const status = args.options.status ?? 'active'
    const active = verb === 'show' || status !== 'archived' ? await node.get('/v1/core/tasks') as Task[] : []
    const archived = verb === 'show' || status !== 'active' ? await node.get('/v1/core/tasks?status=archived') as ArchivedTask[] : []
    if (!Array.isArray(active) || !Array.isArray(archived)) return unexpected()
    const resources = [...active, ...archived].map((row) => taskResource(node.nodeId, row))
    return verb === 'show' ? found(resources.find((row) => row.id === requiredId(id)), id!)
      : resources.filter((row) => !args.options.project || row.projectId === args.options.project)
  }
  if (subject === 'plugin' && verb === 'list' && !id) {
    const state = await node.get('/v1/core/plugins') as NodePluginState
    if (!Array.isArray(state?.plugins)) return unexpected()
    return pluginResources(node.nodeId, state)
  }
  throw new CliError('usage', 'Unknown command. Run acorn --help.', 2)
}
