// ── Manifest runtime contributions ───────────────────────────────────────────────────────────────

/** The deliberately small JSON Schema language accepted by `contributions.agentTools`. Remote and
 * recursive references, combinators and executable validators are not part of this contract. */
export type PluginToolJsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, PluginToolJsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: PluginToolJsonSchema
  enum?: unknown[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export type PluginAgentToolDescriptor = {
  id: string
  description: string
  inputSchema: PluginToolJsonSchema
  risk: 'read' | 'write' | 'execute'
  scope?: 'task'
  handler: string
  requiresSession?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
}

export type PluginContextSectionDescriptor = {
  id: string
  label: string
  scope?: 'task'
  order: number
  read: string
  defaultIncluded?: boolean
  timeoutMs?: number
  maxBytes: number
  maxTokens: number
}

/** A manifest-declared headless command served by this plugin's Node worker. */
export type PluginCliCommandDescriptor = {
  name: string
  title: string
  summary: string
  effects?: string
  risk: 'read' | 'write'
  scope: 'node' | 'workspace' | 'project' | 'task'
  capability: string
  inputSchema: PluginToolJsonSchema
  outputSchema: PluginToolJsonSchema
  route: { method: 'POST'; path: string }
}
