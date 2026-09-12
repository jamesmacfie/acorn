// The helper wire: what the renderer and the desktop helper say to each other over one loopback
// WebSocket. See docs/shell.md, "The shell process".
//
// The helper re-parses every payload with a Zod schema. The renderer is first-party code, but it is
// also the only part of the system that renders third-party content, so its messages are a trust
// boundary.

export const HELPER_PROTOCOL = 1

// Every call is request and reply, including the ones the seam types as void. One code path is worth
// more than the bytes a fire-and-forget notification saves, and a reply is what lets a caller see
// "this build cannot tunnel" instead of silence.
export type HelperMethod =
  | 'renderer-pulse'
  | 'node-fetch'
  | 'node-abort'
  | 'node-send'
  | 'fleet-list'
  | 'node-probe'
  | 'node-pair'
  | 'node-adopt'
  | 'node-rename'
  | 'node-forget'
  | 'node-reconnect'
  | 'node-restart-local'
  | 'node-tunnel-open'
  | 'node-tunnel-close'
  | 'plugins-state'
  | 'plugins-cache-put'
  | 'plugins-trust-record'
  | 'plugins-dev-grant'

export type HelperRequest = { id: number; method: HelperMethod; params: unknown }
export type HelperReplyTiming = {
  /** Wall-clock marks from the helper, which shares this machine's clock with the renderer. */
  receivedAt: number
  repliedAt: number
  /** Monotonic time spent awaiting and executing the helper handler. */
  handlerMs: number
}
export type HelperReply = (
  { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }
) & {
  /** Optional so a renderer can tolerate a helper from before this diagnostic field existed. */
  timing?: HelperReplyTiming
}

// Pushes carry no id. `node-replaced` means the node the renderer was talking to has a new endpoint,
// certificate, and token, so whatever is rendering has to start over.
export type HelperPush =
  | { push: 'node-frame'; nodeId: string; frame: unknown }
  | { push: 'node-status'; status: unknown }
  | { push: 'node-replaced' }

export type HelperMessage = HelperReply | HelperPush

export const isPush = (message: HelperMessage): message is HelperPush => 'push' in message

// ── The binary push ───────────────────────────────────────────────────────────────────────────────
//
// One push does not ride the JSON above: terminal output. The upgrade this file used to describe as
// hypothetical — "an id-tagged binary WebSocket frame beside the JSON reply" — is built, in
// @acorn/protocol/ws.ts § The one binary frame, and phase 6 of the performance programme took it for
// the one channel measured in frames per second.
//
// The frame is the node id, then the frame the node sent, which is itself the session id and then the
// pseudo-terminal's bytes. So the renderer peels two ids and hands the rest to the xterm for that
// session, with no JSON parse and no base64 on the way.
//
// Request and response bodies stay base64 below. Nothing but terminal output has reached the ceiling
// that would justify moving them (docs/performance.md § Replacing base64 on the helper
// wire ahead of a measurement).

// Request and response bodies are bytes, and this channel is JSON, so they ride as base64.
//
// base64 costs a third more bytes and one copy each way on a loopback socket, which is nothing next
// to the request it is part of until a response reaches tens of megabytes. If one ever does, the
// upgrade is an id-tagged binary WebSocket frame beside the JSON reply rather than a second
// transport. Both ends of this file already agree on the id.
const CHUNK = 0x8000

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  // Chunked because `String.fromCharCode(...bytes)` spreads every byte as an argument and blows the
  // stack somewhere past a hundred kilobytes.
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function decodeBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// `NodeFetchRequest` and `NodeFetchResponse` with every `Uint8Array` swapped for its base64 spelling.
// Declared structurally rather than derived from the protocol types, because the wire is what the two
// ends agree on and the helper re-parses the decoded value against the real schema.
export type WireFetchBody =
  | { kind: 'bytes'; bytes: string }
  | { kind: 'form'; parts: ({ name: string; value: string } | { name: string; filename: string; type: string; bytes: string })[] }
export type WireFetchRequest = {
  requestId: string
  path: string
  method?: string
  headers?: Record<string, string>
  body?: WireFetchBody
  timeoutMs?: number
}
export type WireFetchResponse = { status: number; headers: Record<string, string>; body: string }
