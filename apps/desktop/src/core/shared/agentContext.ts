import type { AgentInputPart } from './managedAgents'

export type AgentContextCaptureScope = {
  taskId: string
  workspaceId?: string
}

export type AgentContextSnapshot = Extract<AgentInputPart, { type: 'context' }>

export type AgentContextOption = {
  id: string
  label: string
  description?: string
  defaultSelected?: boolean
}

// Portable Acorn-side ceiling. Providers may advertise a smaller turn limit, which their driver
// enforces before dispatch. Keeping the local snapshot bounded makes replay and inspection safe.
export const MAX_AGENT_CONTEXT_BYTES = 512 * 1024

export const agentContextBudget = (contexts: AgentContextSnapshot[]): {
  bytes: number
  estimatedTokens: number
  overLimit: boolean
} => {
  const bytes = contexts.reduce(
    (total, context) => total + (context.byteSize ?? new TextEncoder().encode(context.content).byteLength),
    0,
  )
  const estimatedTokens = contexts.reduce(
    (total, context) => total + (context.estimatedTokens
      ?? Math.ceil((context.byteSize ?? context.content.length) / 4)),
    0,
  )
  return { bytes, estimatedTokens, overLimit: bytes > MAX_AGENT_CONTEXT_BYTES }
}

export type AgentContextContribution = {
  id: string
  source: string
  label: string
  description?: string
  revision?(scope: AgentContextCaptureScope): number
  options(scope: AgentContextCaptureScope): Promise<AgentContextOption[]>
  capture(scope: AgentContextCaptureScope, optionIds?: readonly string[]): Promise<AgentContextSnapshot[]>
}
