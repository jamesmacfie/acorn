import { z } from 'zod'
import type { NodeProbeResult, NodeRecord, NodeStatus } from './broker.ts'

// The browser extension's native messaging contract: the identities a host registration allows, the
// frame limits, and the typed operations. The browser extension and the CLI's native host are both
// apps and may not import each other, so the contract lives here. docs/browser-extension.md owns it.
// Named for the extension: `browser` is a plugin's ID, and protocol modules named for a plugin are a
// closed list in tools/arch/boundaries.test.ts.

export const BROWSER_BRIDGE_PROTOCOL_VERSION = 1

export type BridgeBrowser = 'chrome' | 'firefox'

// Two host names, so a development session never replaces the host the standalone CLI installed.
export const BROWSER_BRIDGE_HOST = 'com.acorn.browser_bridge'
export const BROWSER_BRIDGE_DEV_HOST = 'com.acorn.browser_bridge_dev'

// The public half of the pinned key. Chrome derives an unpacked extension's ID from the manifest
// `key`, so every checkout loads as the same ID and matches the host allowlist without reinstalling.
// Nothing signs with the private half; an unpacked build never needs it.
export const CHROME_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxovQWXTCjsT0iNRL4br5PQ4+JG3wDwpMwFWS/d0H9eyOdElbYLPxtVs+BBd1E8DQLGjeXy9gQPrI0dIAhoSYkIARcmZwLyRriAcdeUCT+SnDQ7xTemPGYl39JfLG9MqiZ/zh+ng8SZZZv8KoTth+X5T/GGoSjsYn/KuccBOU/M4x6rJepTwFML/5Yqee30n1ynJ3e8q44tJ6TcMm556JgumUWFIM7E7P0gGQN2FXTDtgz1QFw0IGVP14yE5NzsUIEvel/ob+weMXAlLp/LrS7BaKQSDaDIt9tCuWRjA+n3hkr4592Yfo7KxD/0cm7s5/1fLAiLFqGiJALpHH7YpsiQIDAQAB'
export const CHROME_EXTENSION_ID = 'ciaaplnahgpccadenkacgipmhmpbddjo'
export const FIREFOX_EXTENSION_ID = 'extension@acorn.dev'

// The registration file a browser reads to find the host. `path` must be absolute: the browser
// starts it without a shell, so nothing on PATH is available.
export function nativeHostRegistration(browser: BridgeBrowser, name: string, path: string) {
  const base = { name, description: 'Acorn browser bridge', path, type: 'stdio' as const }
  return browser === 'chrome'
    ? { ...base, allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] }
    : { ...base, allowed_extensions: [FIREFOX_EXTENSION_ID] }
}

// Both browsers refuse a single host-to-browser message over 1 MiB. A reply is split into chunks of
// this many UTF-16 units: each costs at most three UTF-8 bytes, or two for an escaped quote, so a
// chunk and its envelope stay under the limit.
export const NATIVE_REPLY_CHUNK_CHARS = 256 * 1024
// The largest request frame the host accepts. Requests are small; a larger length header means the
// stream is corrupt or hostile, and the host closes rather than allocating it.
export const NATIVE_REQUEST_MAX_BYTES = 256 * 1024
// The largest reply the extension reassembles from chunks before it gives up on that request.
export const NATIVE_REPLY_MAX_CHARS = 16 * 1024 * 1024

// The most conversation events one `session.read` asks for. A page folds tool updates and drops the
// bulky fields before it leaves the host, so a full page stays far below NATIVE_REPLY_MAX_CHARS.
const SESSION_READ_MAX_EVENTS = 500
// The longest message the sidebar may send. Three UTF-8 bytes a character keeps the request frame
// under NATIVE_REQUEST_MAX_BYTES.
export const TURN_TEXT_MAX_CHARS = 60_000

const requestId = z.string().min(1).max(64)
const nodeId = z.string().min(1).max(128)
const rowId = z.string().min(1).max(128)
// The agents routes' own bounds on an idempotency key.
const operationKey = z.string().min(8).max(200)
const envelope = { v: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION), id: requestId }

export const bridgeRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({ ...envelope, op: z.literal('nodes.list') }),
  z.strictObject({ ...envelope, op: z.literal('node.probe'), endpoint: z.string().url().max(2048) }),
  // No endpoint or fingerprint: pairing completes the probe the person just confirmed.
  z.strictObject({
    ...envelope,
    op: z.literal('node.pair'),
    code: z.string().trim().min(1).max(256),
    label: z.string().trim().min(1).max(120),
  }),
  z.strictObject({ ...envelope, op: z.literal('node.select'), nodeId: nodeId.nullable() }),
  z.strictObject({ ...envelope, op: z.literal('node.forget'), nodeId }),
  // Bound to the node it was asked of. The host refuses it once that node is no longer selected.
  z.strictObject({ ...envelope, op: z.literal('projects.list'), nodeId }),
  z.strictObject({ ...envelope, op: z.literal('tasks.list'), nodeId, projectId: rowId }),
  z.strictObject({ ...envelope, op: z.literal('agents.profiles'), nodeId }),
  z.strictObject({ ...envelope, op: z.literal('sessions.list'), nodeId, taskId: rowId }),
  z.strictObject({
    ...envelope,
    op: z.literal('session.read'),
    nodeId,
    sessionId: rowId,
    afterSeq: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(SESSION_READ_MAX_EVENTS),
  }),
  // Writes carry the key the sidebar keeps with its draft, so an explicit retry can't make a second
  // session or turn. The host checks the selection before a write and never after: once sent, its
  // outcome is reported whatever was selected since.
  z.strictObject({
    ...envelope,
    op: z.literal('session.create'),
    nodeId,
    taskId: rowId,
    providerId: z.string().min(1).max(100),
    profileId: z.string().min(1).max(100),
    key: operationKey,
  }),
  z.strictObject({
    ...envelope,
    op: z.literal('turn.submit'),
    nodeId,
    sessionId: rowId,
    text: z.string().min(1).max(TURN_TEXT_MAX_CHARS),
    key: operationKey,
  }),
])
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>
export type BridgeOperation = BridgeRequest['op']

export type BridgeProject = { id: string; name: string; path: string | null; hidden: boolean }
export type BridgeNodes = { nodes: NodeRecord[]; activeNodeId: string | null; status: NodeStatus | null }

export type BridgeTask = { id: string; title: string; branch: string | null }

// An agent harness the Node can start a session with, from the agents plugin's provider roster.
export type BridgeAgentProfile = {
  providerId: string
  profileId: string
  label: string
  installed: boolean
  authenticated: boolean | null
  diagnostics: string[]
}

// The fields of the agents plugin's session row the sidebar draws. `runtimeState` and `attention`
// carry that plugin's values unchanged.
export type BridgeAgentSession = {
  id: string
  taskId: string
  title: string
  providerId: string
  profileId: string
  kind: string
  runtimeState: string
  attention: string
  lastEventSeq: number
  archivedAt: number | null
  updatedAt: number
}

// What the sidebar draws of one agent event: the session's own messages, its tool calls, and its
// errors. The host keeps the agents plugin's record identity and drops everything else, including a
// tool's input and output, which a summary never shows and which can be megabytes.
export type BridgeConversationEvent =
  | { type: 'user_message'; text: string }
  | { type: 'assistant_message'; text: string; messageId?: string; append?: boolean }
  // `title` and `status` absent mean unchanged, as on the agents plugin's tool call.
  | { type: 'tool'; toolId: string; title?: string; status?: string }
  | { type: 'error'; message: string }

export type BridgeConversationRecord = {
  id: string
  seq: number
  turnId: string | null
  createdAt: number
  // Set when the Node folded later updates of this tool call into it: the last seq it absorbed.
  foldedThroughSeq?: number
  event: BridgeConversationEvent
}

export type BridgeSessionRead = {
  nodeId: string
  sessionId: string
  session: BridgeAgentSession
  records: BridgeConversationRecord[]
  // The furthest seq the page covered, counting the events the host left out. The next read starts
  // here.
  reach: number
  // Turns accepted but not yet sent to the agent. Their message joins the conversation at dispatch.
  queued: { id: string; text: string }[]
}

export type BridgeResults = {
  'nodes.list': BridgeNodes
  'node.probe': NodeProbeResult
  'node.pair': NodeRecord
  'node.select': BridgeNodes
  'node.forget': BridgeNodes
  'projects.list': { nodeId: string; projects: BridgeProject[] }
  'tasks.list': { nodeId: string; projectId: string; tasks: BridgeTask[] }
  'agents.profiles': { nodeId: string; profiles: BridgeAgentProfile[] }
  'sessions.list': { nodeId: string; taskId: string; sessions: BridgeAgentSession[] }
  'session.read': BridgeSessionRead
  'session.create': { nodeId: string; session: BridgeAgentSession }
  'turn.submit': { nodeId: string; sessionId: string; turnId: string }
}

// Which sessions and tasks changed on the selected Node since the last hint. Nothing more: the
// sidebar reads the durable state again rather than trusting a pushed copy. `missed` means the Node
// dropped frames for this reader, so anything may have changed.
export type BridgeAgentHint = { nodeId: string; sessions: string[]; tasks: string[]; missed: boolean }

export type BridgeErrorCode =
  | 'bad_request'
  | 'no_probe'
  | 'pairing_failed'
  | 'pairing_required'
  | 'unknown_node'
  | 'not_selected'
  | 'incompatible'
  | 'identity_mismatch'
  | 'revoked'
  | 'node_unreachable'
  | 'not_found'
  // A write whose request may have reached the Node. Retry it with the same key.
  | 'ambiguous_mutation'
  | 'node_error'
type BridgeError = { code: BridgeErrorCode; message: string }

// Host to extension. A reply answers one request; chunks carry a reply too large for one message;
// a status event reports the selected node's connection; an agents event is a coalesced change hint.
export type BridgeHostMessage =
  | { v: 1; id: string; ok: true; result: unknown }
  | { v: 1; id: string; ok: false; error: BridgeError }
  | { v: 1; id: string; chunk: { index: number; count: number; data: string } }
  | { v: 1; event: 'status'; status: NodeStatus }
  | ({ v: 1; event: 'agent' } & BridgeAgentHint)
