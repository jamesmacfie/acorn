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

const requestId = z.string().min(1).max(64)
const nodeId = z.string().min(1).max(128)
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
])
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>
export type BridgeOperation = BridgeRequest['op']

export type BridgeProject = { id: string; name: string; path: string | null; hidden: boolean }
export type BridgeNodes = { nodes: NodeRecord[]; activeNodeId: string | null; status: NodeStatus | null }

export type BridgeResults = {
  'nodes.list': BridgeNodes
  'node.probe': NodeProbeResult
  'node.pair': NodeRecord
  'node.select': BridgeNodes
  'node.forget': BridgeNodes
  'projects.list': { nodeId: string; projects: BridgeProject[] }
}

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
  | 'node_error'
type BridgeError = { code: BridgeErrorCode; message: string }

// Host to extension. A reply answers one request; chunks carry a reply too large for one message;
// a status event reports the selected node's connection.
export type BridgeHostMessage =
  | { v: 1; id: string; ok: true; result: unknown }
  | { v: 1; id: string; ok: false; error: BridgeError }
  | { v: 1; id: string; chunk: { index: number; count: number; data: string } }
  | { v: 1; event: 'status'; status: NodeStatus }
