import type { Component } from 'solid-js'
import type { AgentToolCall } from '../../shared/managedAgents'
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
