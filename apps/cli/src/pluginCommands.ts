import type { NodePluginState } from '@acorn/protocol/api.ts'
import type { PluginCliCommandDescriptor } from '@acorn/protocol/plugin/cliCommands.ts'
import { validatePluginCliValue, PLUGIN_CLI_INPUT_MAX_BYTES } from '@acorn/protocol/plugin/cliCommands.ts'
import type { ParsedArgs } from './args'
import { CliError } from './error'
import { readJsonFile, requestKey } from './input'
import type { CliNode } from './node'

const apiVersion = 'acorn.cli/v1'

async function active(node: CliNode, id: string) {
  const state = await node.get('/v1/core/plugins') as NodePluginState
  if (!Array.isArray(state?.plugins)) throw new CliError('invalid_response', 'The Node returned an invalid plugin roster.', 1)
  const row = state.plugins.find((entry) => entry.name === id)
  if (!row?.running || row.disabled || row.active?.activation !== 'node') throw new CliError('not_found', `Plugin ${id} is not active on Node ${node.nodeId}.`, 4)
  return row
}

const resource = (nodeId: string, pluginId: string, descriptor: PluginCliCommandDescriptor) => ({
  apiVersion, kind: 'PluginCommand', nodeId, id: `${pluginId}:${descriptor.name}`, pluginId, name: descriptor.name,
  title: descriptor.title, summary: descriptor.summary, effects: descriptor.effects ?? null,
  risk: descriptor.risk, scope: descriptor.scope, capability: descriptor.capability,
  inputSchema: descriptor.inputSchema, outputSchema: descriptor.outputSchema,
})

export async function pluginCommandHelp(node: CliNode, args: ParsedArgs): Promise<string> {
  const [, id, command] = args.positionals
  const row = await active(node, id!)
  const descriptor = row.active!.contributions.cliCommands?.find((entry) => entry.name === command)
  if (!descriptor) throw new CliError('not_found', `Plugin ${id} has no command ${command} on this Node.`, 4)
  return `Usage: acorn plugin ${id} ${command} --input-file FILE|- [--request-id UUID]\n${descriptor.title}: ${descriptor.summary}\nRisk: ${descriptor.risk}; scope: ${descriptor.scope}; capability: ${descriptor.capability}\n${descriptor.effects ? `Effects: ${descriptor.effects}\n` : ''}Input schema: ${JSON.stringify(descriptor.inputSchema, null, 2)}\nOutput schema: ${JSON.stringify(descriptor.outputSchema, null, 2)}\n`
}

export async function runPluginCommand(node: CliNode, args: ParsedArgs): Promise<unknown> {
  const [, id, command] = args.positionals
  const row = await active(node, id!)
  const descriptors = row.active!.contributions.cliCommands ?? []
  if (command === 'commands') return descriptors.map((descriptor) => resource(node.nodeId, id!, descriptor))
  const descriptor = descriptors.find((entry) => entry.name === command)
  if (!descriptor) throw new CliError('not_found', `Plugin ${id} has no command ${command} on this Node.`, 4)
  const file = args.options['input-file']
  if (!file) throw new CliError('usage', '--input-file is required.', 2)
  const input = await readJsonFile(file, PLUGIN_CLI_INPUT_MAX_BYTES)
  const errors = validatePluginCliValue(descriptor.inputSchema, input)
  if (errors.length) throw new CliError('invalid_input', errors.map((issue) => `${issue.path}: ${issue.message}`).join('; '), 2)
  if ((input as { nodeId?: unknown }).nodeId !== node.nodeId) throw new CliError('invalid_input', `$.nodeId must be ${node.nodeId}.`, 2)
  const result = await node.mutate('POST', `/v1/core/plugins/${encodeURIComponent(id!)}/cli/${encodeURIComponent(command!)}`, { input },
    requestKey(args.options['request-id'])) as { result?: unknown }
  if (!result || !('result' in result)) throw new CliError('invalid_response', 'The Node returned no command result.', 1)
  const outputErrors = validatePluginCliValue(descriptor.outputSchema, result.result)
  if (outputErrors.length) throw new CliError('invalid_response', `Plugin output failed its schema: ${outputErrors.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`, 1)
  return { apiVersion, kind: 'PluginCommandResult', nodeId: node.nodeId, id: `${id}:${command}`, pluginId: id, command, result: result.result }
}
