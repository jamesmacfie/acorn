import type {
  AgentArtifactKind,
  AgentConfigOption,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'

/**
 * Binary output from a provider before Acorn takes custody of it. This type never crosses the wire
 * or reaches the event ledger: ProviderEventMaterializer stores the bytes and replaces it with the
 * ordinary artifact event every client already understands.
 */
export type AgentDriverGeneratedArtifact = {
  type: 'generated_artifact'
  kind: AgentArtifactKind
  title: string
  mediaType: string
  bytes: Uint8Array
}

export type AgentDriverEvent = AgentNormalizedEvent | AgentDriverGeneratedArtifact

/**
 * An MCP server acorn asks the agent to connect to, for the session it is starting.
 *
 * Neutral of any one protocol's spelling: the generic driver converts it to ACP's stdio form. Every
 * field is what a child process needs, so `command` is absolute (an agent may reject a relative one)
 * and `env` carries the whole launch environment rather than relying on inheritance. An agent that
 * scrubs credential-shaped names out of what it passes down would otherwise drop the token, which is
 * exactly what DeepSeek does.
 */
export type AgentDriverMcpServer = {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

export type AgentDriverStartOptions = {
  session: AgentSession
  cwd: string
  env: Record<string, string>
  /** acorn's own tool servers, or empty for a harness that registers them through its CLI's config
   *  instead (docs/mcp.md § Configuration). Empty is a real answer, never a forgotten one. */
  mcpServers: readonly AgentDriverMcpServer[]
  noProviderExecutionHistory: boolean
  onEvent(event: AgentDriverEvent): void | Promise<void>
  onClosed(error?: Error): void | Promise<void>
}

export type AgentDriverTurnOptions = {
  turn: AgentTurn
  input: AgentInputPart[]
  attachments: Record<string, {
    id: string
    filename: string
    mediaType: string
    byteSize: number
    localPath: string
  }>
}

export interface AgentDriverSession {
  readonly providerSessionRef: string | null
  readonly ready: boolean
  sendTurn(options: AgentDriverTurnOptions): Promise<{ providerTurnRef?: string }>
  cancel(): Promise<void>
  resolveRequest(providerRequestId: string, resolution: unknown): Promise<void>
  setConfig?(optionId: string, value: string): Promise<AgentConfigOption[] | void>
  fork?(): Promise<string>
  compact?(): Promise<void>
  archive?(archived: boolean): Promise<void>
  delete?(): Promise<void>
  stop(): Promise<void>
}

export interface AgentDriver {
  readonly providerId: string
  readonly profileId: string
  probe(): Promise<AgentProviderDescriptor>
  start(options: AgentDriverStartOptions): Promise<AgentDriverSession>
  classifyTurnFailure?(error: unknown): 'safe_transient' | 'uncertain' | 'permanent'
}

export type AgentDriverFactory = () => AgentDriver
