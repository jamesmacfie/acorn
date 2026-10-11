import type {} from '@acorn/protocol/plugin/runtimeContributions.ts'
import type { PluginCliCommandDescriptor } from '@acorn/protocol/plugin/cliCommands.ts'

/** A complete read command; tests can replace the schema, risk, or scope. */
export const testCliCommandDescriptor = (
  overrides: Partial<PluginCliCommandDescriptor> = {},
): PluginCliCommandDescriptor => ({
  name: 'probe',
  title: 'Read probe',
  summary: 'Read a fixture value.',
  risk: 'read',
  scope: 'node',
  capability: 'tasks',
  route: { method: 'POST', path: '/cli/probe' },
  inputSchema: {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
  ...overrides,
})
