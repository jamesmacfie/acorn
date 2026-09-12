import type { PluginAgentToolDescriptor, PluginContextSectionDescriptor } from '@acorn/protocol/plugin/runtimeContributions.ts'

/** Minimal valid manifest tool descriptor for author tests. Override only the behavior under test. */
export const testAgentToolDescriptor = (
  overrides: Partial<PluginAgentToolDescriptor> = {},
): PluginAgentToolDescriptor => ({
  id: 'probe',
  description: 'Read one probe value.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  risk: 'read',
  scope: 'task',
  handler: '/v2/p/test/tools/probe',
  requiresSession: false,
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
  ...overrides,
})

/** Minimal valid manifest context descriptor for author tests. */
export const testContextSectionDescriptor = (
  overrides: Partial<PluginContextSectionDescriptor> = {},
): PluginContextSectionDescriptor => ({
  id: 'probe',
  label: 'Probe',
  scope: 'task',
  order: 500,
  read: '/v2/p/test/context/probe',
  defaultIncluded: false,
  timeoutMs: 1_000,
  maxBytes: 4_096,
  maxTokens: 1_024,
  ...overrides,
})
