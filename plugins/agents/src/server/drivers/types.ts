import type {
  AgentArtifactKind,
  AgentConfigOption,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
} from '../../contract/wire.ts'
import type { AgentMcpReportedServer } from '../../shared/mcpServers'

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
 * Neutral of any one protocol's spelling: each driver converts it to its own form. For a stdio server,
 * every field is what a child process needs, so `command` is absolute when acorn resolved it (an agent
 * may reject a relative one) and `env` carries the whole launch environment rather than relying on
 * inheritance. An agent that scrubs credential-shaped names out of what it passes down would otherwise
 * drop the token, which is exactly what DeepSeek does.
 */
export type AgentDriverMcpServer =
  | { transport: 'stdio'; name: string; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; name: string; url: string; headers: Record<string, string> }

export type AgentDriverStartOptions = {
  /** Local compiled-runtime cancellation. This signal never crosses plugin RPC. */
  signal?: AbortSignal
  session: AgentSession
  cwd: string
  env: Record<string, string>
  /** acorn's own tool server, when this harness has no CLI registration for it (docs/mcp.md
   *  § Configuration), followed by the user's servers this session has switched on (docs/mcp.md § Your
   *  own servers). Empty is a real answer, never a forgotten one. */
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
  /** The provider child's process id, for Settings > Storage and memory. Its descendants, the MCP
   *  servers among them, are found from it. Absent when the harness does not know one. */
  readonly pid?: number
  sendTurn(options: AgentDriverTurnOptions): Promise<{ providerTurnRef?: string }>
  cancel(): Promise<void>
  resolveRequest(providerRequestId: string, resolution: unknown): Promise<void>
  setConfig?(optionId: string, value: string): Promise<AgentConfigOption[] | void>
  fork?(): Promise<string>
  compact?(): Promise<void>
  /** Every MCP server the harness has, its own config's included, as it reports them right now. Absent
   *  when the harness reports nothing live, which is Claude Code's case (docs/mcp.md § Your own servers). */
  mcpStatus?(): Promise<AgentMcpReportedServer[]>
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
