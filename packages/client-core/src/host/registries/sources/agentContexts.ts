import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { Registry } from '../../../kit/lib/state/registry'

export const agentContextRegistry = new Registry<AgentContextContribution>('agent context')

export const agentContextContributions = (): readonly AgentContextContribution[] =>
  [...agentContextRegistry.entries()].sort((a, b) => a.label.localeCompare(b.label))
