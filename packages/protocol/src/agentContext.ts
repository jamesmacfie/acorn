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

// ── What a loaded plugin's agent-context routes may answer ─────────────────────────────────────────
//
// A loaded plugin declares `agentContexts` in its manifest and the HOST performs both fetches on its
// behalf (node-core/main/pluginManifest.ts, client-core/plugins/chrome/data.ts). Unlike the rest of
// the descriptor chrome — which decorates the shell, where a malformed row costs a badge — these
// bodies end up inside a model's prompt. That is why this is the one descriptor response with a real
// parser instead of a field-by-field sniff, and why the schemas live here beside the contract rather
// than in the reader: the host owns the shape, and the host is the one being handed it.
//
// Three groups of fields are ABSENT on purpose, because the host binds them:
//
//   `type` and `source` — `source` is derived from the supplying plugin's id, the same rule that
//   stops a descriptor row claiming another plugin's task origin. A plugin does not get to name the
//   namespace its snapshots appear under, because the composer groups and replaces by it.
//
//   `capturedAt` — a fact about when the host captured, not something a plugin may backdate.
//
//   `byteSize` and `estimatedTokens` — `agentContextBudget` above trusts these over the real content
//   when they are present, which is exactly the wrong way round for plugin-supplied data: a snapshot
//   claiming `byteSize: 1` on five megabytes of content would walk straight through the composer's
//   512 KiB ceiling. The host measures the content it actually received.
export const MAX_PLUGIN_AGENT_CONTEXT_OPTIONS = 200
export const MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS = 50

export const pluginAgentContextOptionsSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(500).optional(),
  defaultSelected: z.boolean().optional(),
})).max(MAX_PLUGIN_AGENT_CONTEXT_OPTIONS)

// `content` is bounded by the shared ceiling as a coarse pre-check — `.max()` counts UTF-16 units, so
// the real refusal is the byte measurement the reader does with `agentContextBudget`.
export const pluginAgentContextSnapshotsSchema = z.array(z.object({
  contextId: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  content: z.string().max(MAX_AGENT_CONTEXT_BYTES),
  resourceId: z.string().min(1).max(200).optional(),
  provenance: z.string().min(1).max(500).optional(),
  // `pane` is checked against the panes the SAME manifest declares before it survives; a deep link
  // into another plugin's pane is the navigation twin of a route outside its own namespace.
  deepLink: z.object({ pane: z.string().min(1).max(64) }).optional(),
  freshness: z.enum(['live', 'cached', 'stale', 'unknown']).optional(),
  sensitivity: z.enum(['public', 'workspace', 'private', 'secret']).optional(),
})).max(MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS)

export type PluginAgentContextSnapshotBody = z.infer<typeof pluginAgentContextSnapshotsSchema>[number]
