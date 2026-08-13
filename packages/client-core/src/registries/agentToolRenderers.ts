import type { Component } from 'solid-js'
import type { AgentToolCall } from '@acorn/protocol/managedAgents.ts'
import { Registry } from './registry'

export type AgentToolRendererProps = {
  tool: AgentToolCall
  taskId: string
}

export type AgentToolRendererContribution = {
  id: string
  matches(tool: AgentToolCall): boolean
  component: Component<AgentToolRendererProps>
}

export const agentToolRendererRegistry =
  new Registry<AgentToolRendererContribution>('agent tool renderer')

/** StatusDot tone for a tool call's status. Here rather than in a plugin because both the agents
 *  plugin and the changes plugin render this dot, and the changes copy was reaching for a class
 *  defined in the agents plugin's stylesheet. */
export const agentToolTone = (status: AgentToolCall['status']): 'ok' | 'warn' | 'bad' | 'muted' | 'accent' => {
  if (status === 'running') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'bad'
  return 'muted'
}
