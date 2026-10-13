import type {
  AgentArtifactKind,
  AgentConfigOption,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
} from '../../contract/wire.ts'
import type { AgentPermissionSubject } from '../../contract/permissionHook.ts'
import type { AgentMcpReportedServer } from '../../shared/mcpServers'
import type { MeasureAgentStartup } from './startupTelemetry'

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

/**
 * A parked permission request, with what a policy hook needs to judge it. Driver-only like the artifact
 * above: the runtime runs `agents:before-permission` on it, and ProviderEventMaterializer keeps only
 * `request`, so the subject never reaches the wire, SQLite, or telemetry.
 *
 * `open` and `respond` reach the request where the driver parked it, so a veto works even while
 * `start` is still running and the runtime holds no session handle yet.
 */
export type AgentDriverPermissionRequest = {
  type: 'permission_request'
  request: Extract<AgentNormalizedEvent, { type: 'request' }>
  subject: AgentPermissionSubject
  /** False once the request was answered, or the harness withdrew it. */
  open(): boolean
  /** Answers the request. Throws when it's no longer open. */
  respond(resolution: unknown): void
}

/** A parked question or form. The callback remains available during provider startup too. */
export type AgentDriverInputRequest = {
  type: 'input_request'
  request: Extract<AgentNormalizedEvent, { type: 'request' }>
  open(): boolean
  respond(resolution: unknown): void
}

/**
 * The agent read a steered message here, at this point in the stream. Driver-only like the artifact
 * above: the runtime records it as that turn's `user_message` under the running turn, so it sits
 * between the output before and after it.
 */
type AgentDriverSteerTaken = {
  type: 'steer_taken'
  /** The steered turn's id, which the driver was given in `AgentDriverSteerOptions.turn`. */
  turnId: string
}

export type AgentDriverEvent = (
  | AgentNormalizedEvent
  | AgentDriverGeneratedArtifact
  | AgentDriverPermissionRequest
  | AgentDriverInputRequest
  | AgentDriverSteerTaken
) & {
  /** Driver-owned attribution. Null explicitly means no managed turn; absent uses the live turn. */
  acornTurnId?: string | null
}

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

/** The bridge program (docs/managed-agents/loop-hooks.md) and which of agents' two loop points have a
 *  handler. `args` ends with the route and version the bridge posts. The harness runs
 *  `command args… <harness> <event>` and does what it prints. */
export type AgentDriverLoopHooks = { command: string; args: string[]; beforeTool: boolean; afterTool: boolean }

/** Keeps a session out of acorn's data root, for a driver with `readBlock` (`dataRootReadBlock`,
 *  docs/managed-agents/read-block.md). Paths are absolute. */
export type AgentDriverReadBlock = {
  dataDir: string
  /** The session's working folder, which its file tools may write. */
  worktree: string
  /** What the agent's commands still read inside the data root: its worktree, its own token file, the
   *  Node's certificate, and its skill folders. */
  readable: string[]
  /** What its commands may write outside the worktree: the parts of the repository's git folders a
   *  commit from a linked worktree writes. */
  writable: string[]
  /** Git files it may never write, even inside `writable` or the worktree, because the Node's own
   *  unsandboxed git would act on them (`gitWrites`). Concrete paths, never globs. */
  writeDenied: string[]
  /** Data root paths holding nothing the agent works in, for the harness's own file tools, which its
   *  shell sandbox doesn't cover. */
  hidden: string[]
  /** `host:port` of the Node's loopback API, for the task CLI. */
  loopback: string | null
  /** The program that checks each of the harness's own file tool calls against this block
   *  (`packages/node-core/src/mcp/fileGuard.ts`). */
  fileGuard: { command: string; args: string[] }
}

/** How a harness's CLI keeps more than one login: one config folder per account, chosen by a variable
 *  (docs/managed-agents/accounts.md). Built-in only for now. */
export type HarnessAccounts = {
  /** The variable that moves the CLI's whole config folder, such as `CLAUDE_CONFIG_DIR`. */
  env: string
  /** CLI arguments that sign in to, and out of, the login in that folder. */
  login: readonly string[]
  logout: readonly string[]
  /** Node variables that would override the folder's login. Removed from a session pinned to an
   *  account, which would otherwise quietly run on the Node's token. */
  overrides?: readonly string[]
  /** Where the default login keeps the person's own skills, and the folder inside an account's that
   *  holds them. Each one is linked into the account before a start (`linkSharedSkills`). The CLI's
   *  own per-login entries, named in `own`, are never linked. */
  skills?: { shared(): string; folder: string; own: readonly string[] }
  /** The default login's settings file, and its name inside an account's folder. It's linked into an
   *  account that has no such file of its own before a start (`linkSharedSettings`). */
  settings?: { shared(): string; file: string }
}

export type AgentDriverStartOptions = {
  /** Local compiled-runtime cancellation. This signal never crosses plugin RPC. */
  signal?: AbortSignal
  /** Local startup timing only. This callback never crosses plugin RPC. */
  measureStartup?: MeasureAgentStartup
  session: AgentSession
  /** Host-resolved bootstrap text for the provider's system or developer instruction channel. */
  attendanceInstructions?: string
  cwd: string
  env: Record<string, string>
  /** acorn's own tool server for managed Codex or a harness without CLI registration (docs/mcp.md
   *  § Configuration), followed by the user's servers this session has switched on (docs/mcp.md § Your
   *  own servers). Empty is a real answer, never a forgotten one. */
  mcpServers: readonly AgentDriverMcpServer[]
  /** The folder of each skill this start may point the agent at (`prepareSkillStart`). A driver whose harness
   *  needs a grant to read outside the worktree gives one for these and nothing else. The index itself
   *  goes ahead of the first turn, from the lifecycle. Absent means none. */
  skillFolders?: readonly string[]
  /** For a driver with `nativeSkills`: the plugin folders of this start's skill copy (`writeSkillFolder`),
   *  for the harness to load as its own. Absent means none. */
  skillPlugins?: readonly string[]
  /** acorn's harness bridge for this start, for a driver with `loopHooks`. Absent when no point has a
   *  handler, so a session nobody would gain from pays no process per tool call. */
  loopHooks?: AgentDriverLoopHooks
  /** For a driver with `accounts`: the config folder of the account the session is pinned to. Absent
   *  means the CLI's own default login. */
  accountHome?: string
  /** For a driver with `readBlock`, when the person switched the block on. Absent means unconfined. */
  readBlock?: AgentDriverReadBlock
  noProviderExecutionHistory: boolean
  onEvent(event: AgentDriverEvent): void | Promise<void>
  onClosed(error?: Error): void | Promise<void>
}

export type AgentDriverTurnOptions = {
  turn: AgentTurn
  input: AgentInputPart[]
  attachments: Record<
    string,
    {
      id: string
      filename: string
      mediaType: string
      byteSize: number
      localPath: string
    }
  >
}

/** A queued turn for the running one: its input, prepared as a send's would be, and the running turn. */
export type AgentDriverSteerOptions = AgentDriverTurnOptions & { activeTurnId: string }

export interface AgentDriverSession {
  readonly providerSessionRef: string | null
  readonly ready: boolean
  /** The provider child's process id, for Settings > Storage and memory. Its descendants, the MCP
   *  servers among them, are found from it. Absent when the harness does not know one. */
  readonly pid?: number
  sendTurn(options: AgentDriverTurnOptions): Promise<{ providerTurnRef?: string }>
  /** Hands a message to the running turn, for the agent to read at its next step. Resolves `taken`
   *  once the driver has emitted `steer_taken` for it, and `missed` when the turn ended first, so the
   *  agent never will. Absent when the harness can't steer (docs/managed-agents/steering.md § Harness support). */
  steer?(options: AgentDriverSteerOptions): Promise<'taken' | 'missed'>
  cancel(): Promise<void>
  /** Interrupts one provider-native child without cancelling the session's own turn. */
  cancelSubagent?(subagentId: string): Promise<void>
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
  /** The harness loads skills from a folder with its own skill support, so the lifecycle writes one for
   *  each start and passes it as `skillPlugins` (docs/managed-agents/native-skills.md § Native skills). */
  readonly nativeSkills?: boolean
  /** The harness takes acorn's bridge, so the lifecycle passes `loopHooks` when a point has a handler. */
  readonly loopHooks?: boolean
  /** The harness can keep its agent out of the data root, so the lifecycle passes `readBlock` when the
   *  person switched it on. */
  readonly readBlock?: boolean
  /** The harness can run more than one login, one config folder each, so a session may be pinned to
   *  an account and the lifecycle passes its folder as `accountHome`. */
  readonly accounts?: HarnessAccounts
  probe(): Promise<AgentProviderDescriptor>
  /** Whether the login in one account's folder is signed in. Present with `accounts`. */
  probeAccount?(home: string): Promise<boolean | null>
  start(options: AgentDriverStartOptions): Promise<AgentDriverSession>
  classifyTurnFailure?(error: unknown): 'safe_transient' | 'uncertain' | 'permanent'
}

export type AgentDriverFactory = () => AgentDriver
