import type { ExternalRef } from '../../integrations/providers.ts'

export type TaskContextInclude = string
export type ContextBudget = {
  maxItems?: number
  maxBytesPerItem?: number
  overflow: 'truncate-tail' | 'index-only' | 'omit-with-marker'
}
export type ContextPaneIntent = {
  pane: string
  itemId?: string
  noteScope?: 'global' | 'workspace' | 'task'
  ref?: ExternalRef
}
export type ContextItem = {
  id: string
  kind: string
  label: string
  providerId?: string // linked external item; stable filter key, unlike its display kind
  body?: string
  details?: string[]
  jump?: ContextPaneIntent
  origin?: { author: 'user' | 'agent' | 'workflow' } // notes section only, for provenance badges
  // Reference data supplied by a section. Loaded contributors cannot supply a renderer or an action;
  // consumers may show these as provenance labels.
  sources?: { label: string; uri?: string }[]
}
export type ContextSectionResult = {
  id: string
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  items: ContextItem[]
  compact: string
  omitted: number
  absent?: { reason: 'missing-cache' | 'unavailable' | 'timeout' | 'invalid-response'; detail: string }
}
export type TaskContext = {
  task: { id: string; title: string; projectId: string; repo?: string; branch: string | null; worktreePath: string | null; pullNumber: number | null }
  sections: ContextSectionResult[]
}
export const taskContextRoute = (id: string, include?: TaskContextInclude[] | 'all') =>
  `/v1/core/tasks/${id}/context${include === 'all' ? '?include=*' : include?.length ? `?include=${include.join(',')}` : ''}`

// Agent tools (docs/agent-tools.md): the registry projects to the harness HTTP surface below and to
// the MCP server. The permissions page reads the static catalog and persists per-tier and per-tool
// toggles as one prefs slice under this key (JSON `{ tiers?, tools? }`).
export type ToolRisk = 'read' | 'write' | 'execute'
export const AGENT_TOOLS_PERMS_PREF_KEY = 'agentTools.perms'
export const agentToolsCatalogRoute = '/v1/core/agent-tools'
// `owner` is the plugin id that contributed the tool, or `core`, so the page can group a plugin's tools
// together. Optional because a node from before it reports none.
export type AgentToolCatalogEntry = { name: string; description: string; risk: ToolRisk; availability?: string; owner?: string }
export const rendererAgentToolRoute = (taskId: string, name: string) => `/v1/core/tasks/${taskId}/renderer-tools/${encodeURIComponent(name)}`
// A tool result the MCP server hands the agent as an image rather than as JSON text. `data` is base64.
export type ToolImageResult = { type: 'image'; mimeType: string; data: string }
export const isToolImageResult = (value: unknown): value is ToolImageResult => {
  const v = value as Partial<ToolImageResult> | null
  return !!v && v.type === 'image' && typeof v.mimeType === 'string' && v.mimeType.startsWith('image/') && typeof v.data === 'string'
}
