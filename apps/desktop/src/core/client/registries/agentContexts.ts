import type { AgentContextContribution } from '../../shared/agentContext'
import { Registry } from './registry'

export const agentContextRegistry = new Registry<AgentContextContribution>('agent context')

export const agentContextContributions = (): readonly AgentContextContribution[] =>
  [...agentContextRegistry.entries()].sort((a, b) => a.label.localeCompare(b.label))
