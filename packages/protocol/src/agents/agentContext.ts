import { z } from 'zod'

export type AgentContextCaptureScope = {
  taskId: string
  workspaceId?: string
  sessionId?: string
}

export type AgentContextSnapshot = {
  type: 'context'
  contextId: string
  label: string
  content: string
  source: string
  resourceId?: string
  provenance?: string
  deepLink?: { pane: string; intent?: Record<string, unknown> }
  byteSize?: number
  estimatedTokens?: number
  freshness?: 'live' | 'cached' | 'stale' | 'unknown'
  sensitivity?: 'public' | 'workspace' | 'private' | 'secret'
  capturedAt: number
  /** The `#keyword:slug` token in the message that asked for this snapshot. The composer sets it at
   *  send, so the model can tell which block a reference in the text means. */
  ref?: string
}

export type AgentContextOption = {
  id: string
  label: string
  description?: string
}

// Portable Acorn-side ceiling. Providers may advertise a smaller turn limit, which their driver
// enforces before dispatch. Keeping the local snapshot bounded makes replay and inspection safe.
export const MAX_AGENT_CONTEXT_BYTES = 512 * 1024

export const agentContextBudget = (
  contexts: AgentContextSnapshot[],
): {
  bytes: number
  estimatedTokens: number
  overLimit: boolean
} => {
  const bytes = contexts.reduce(
    (total, context) => total + (context.byteSize ?? new TextEncoder().encode(context.content).byteLength),
    0,
  )
  const estimatedTokens = contexts.reduce(
    (total, context) =>
      total + (context.estimatedTokens ?? Math.ceil((context.byteSize ?? context.content.length) / 4)),
    0,
  )
  return { bytes, estimatedTokens, overLimit: bytes > MAX_AGENT_CONTEXT_BYTES }
}

export type AgentContextContribution = {
  id: string
  source: string
  /** What follows `#` in the composer, such as `agent` in `#agent:refactor-login`. Lowercase letters,
   *  digits, and hyphens, starting with a letter. The host binds it for a loaded plugin. */
  keyword: string
  label: string
  description?: string
  /** No items: referenced as a bare `#keyword`, and captured with no option ids. */
  itemless?: boolean
  /** The source answers `query` itself, instead of listing everything for the composer to filter. */
  search?: boolean
  revision?(scope: AgentContextCaptureScope): number
  options(scope: AgentContextCaptureScope, query?: string): Promise<AgentContextOption[]>
  capture(scope: AgentContextCaptureScope, optionIds?: readonly string[]): Promise<AgentContextSnapshot[]>
}

/** The shape a keyword takes. The host checks a loaded plugin's against it. */
export const AGENT_CONTEXT_KEYWORD = /^[a-z][a-z0-9-]*$/

/** Keywords only first-party sources may use. A loaded plugin asking for one gets it qualified. */
export const RESERVED_AGENT_CONTEXT_KEYWORDS: ReadonlySet<string> = new Set([
  'agent',
  'terminal',
  'docker',
  'task',
  'file',
  'skill',
])

// What a loaded plugin's agent-context routes may answer. See docs/plugins/client-half.md § Loaded plugins: the
// client half (the `agentContexts` entry) for the full contract: why this is the one descriptor
// response with a real parser, and which fields the host binds rather than the plugin.
export const MAX_PLUGIN_AGENT_CONTEXT_OPTIONS = 200
const MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS = 50

export const pluginAgentContextOptionsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(200),
      label: z.string().min(1).max(200),
      description: z.string().min(1).max(500).optional(),
    }),
  )
  .max(MAX_PLUGIN_AGENT_CONTEXT_OPTIONS)

// `content` is bounded by the shared ceiling as a coarse pre-check. `.max()` counts UTF-16 units, so
// the real refusal is the byte measurement the reader does with `agentContextBudget`.
export const pluginAgentContextSnapshotsSchema = z
  .array(
    z.object({
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
    }),
  )
  .max(MAX_PLUGIN_AGENT_CONTEXT_SNAPSHOTS)

export type PluginAgentContextSnapshotBody = z.infer<typeof pluginAgentContextSnapshotsSchema>[number]
