import { z } from 'zod'
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

// What a loaded plugin's agent-context routes may answer. See docs/plugins.md § Loaded plugins: the
// client half (the `agentContexts` entry) for the full contract: why this is the one descriptor
// response with a real parser, and which fields the host binds rather than the plugin.
export const MAX_PLUGIN_AGENT_CONTEXT_OPTIONS = 200
export const MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS = 50

export const pluginAgentContextOptionsSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(500).optional(),
  defaultSelected: z.boolean().optional(),
})).max(MAX_PLUGIN_AGENT_CONTEXT_OPTIONS)

// `content` is bounded by the shared ceiling as a coarse pre-check. `.max()` counts UTF-16 units, so
// the real refusal is the byte measurement the reader does with `agentContextBudget`.
export const pluginAgentContextSnapshotsSchema = z.array(z.object({
  contextId: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  content: z.string().max(MAX_AGENT_CONTEXT_BYTES),
  resourceId: z.string().min(1).max(200).optional(),
  provenance: z.string().min(1).max(500).optional(),
  // `pane` is checked against the panes the same manifest declares before it survives; a deep link
  // into another plugin's pane is the navigation twin of a route outside its own namespace.
  deepLink: z.object({ pane: z.string().min(1).max(64) }).optional(),
  freshness: z.enum(['live', 'cached', 'stale', 'unknown']).optional(),
  sensitivity: z.enum(['public', 'workspace', 'private', 'secret']).optional(),
})).max(MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS)

export type PluginAgentContextSnapshotBody = z.infer<typeof pluginAgentContextSnapshotsSchema>[number]
