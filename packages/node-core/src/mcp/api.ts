import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Loopback HTTPS client for the acorn MCP server (docs/mcp.md): every tool call goes through the
// running app's Hono API with the per-run internal bearer — tools NEVER open their own DB or
// GitHub client, so they stay in sync with the UI for free. Failures are structured results
// ('acorn-not-running' / 'api-error'), never throws — the tool layer renders them as text.
//
// The endpoint is resolved from the DATA ROOT, not from a baked URL, and that is the whole point of
// this module's shape. This process can outlive the node that spawned it: agent panes run in tmux, are
// reattached after an acorn restart, and the child keeps the environment of the boot that created the
// session. The internal token survives that (it is persisted — main/bindings.ts), but the port does
// not: it is ephemeral now, so a baked ACORN_API_URL points at nothing after a restart. `<dataDir>/
// node.json` is the one thing that is both stable in location and current in content.
//
// TLS needs no code here at all: the node's certificate is a CA with an IP:127.0.0.1 SAN, and the
// service exports NODE_EXTRA_CA_CERTS pointing at it, so fetch() validates FULLY.
// ponytail: NODE_EXTRA_CA_CERTS's ceiling, for whoever hits it — it is read once at process start (so
// a cert replaced mid-life needs a restart), it is ignored under --use-openssl-ca, and it is honoured
// only by Node/Electron processes. Every child acorn spawns is one of those, and a third-party binary
// that talked to the node would need its own trust story regardless.
const DATA_DIR = process.env.ACORN_DATA_DIR ?? ''
// A fixed origin, used when there is no data root to resolve from. That is the test path (and any
// caller wiring this up by hand); the app always passes ACORN_DATA_DIR.
const STATIC_URL = process.env.ACORN_API_URL ?? ''
const API_TOKEN = process.env.ACORN_API_TOKEN ?? ''
// The agent session id (provenance): stamped on notes/memory writes server-side. Transport
// metadata, never a tool arg — sent on every call so the harness can attribute writes.
const SESSION_ID = process.env.ACORN_SESSION_ID ?? ''
const TOOL_CEILING = process.env.ACORN_TOOL_CEILING ?? ''

export type ApiResult = { ok: true; data: unknown } | { ok: false; kind: 'acorn-not-running' | 'api-error'; detail: string }

let cachedUrl: string | null = null

// Read the port the node most recently bound. Returns '' when the root holds no port yet (a node that
// has never listened) or is unreadable — which surfaces as 'acorn-not-running', the honest answer.
function readEndpoint(): string {
  if (!DATA_DIR) return STATIC_URL
  try {
    const { port } = JSON.parse(readFileSync(join(DATA_DIR, 'node.json'), 'utf8')) as { port?: number }
    return typeof port === 'number' && port > 0 ? `https://127.0.0.1:${port}` : ''
  } catch {
    return ''
  }
}

// Only a real endpoint is cached. Caching '' would make "acorn was not running when the first tool
// fired" permanent for the life of this process, and a tmux-reattached agent lives for days.
function endpoint(): string {
  if (cachedUrl) return cachedUrl
  const resolved = readEndpoint()
  if (resolved) cachedUrl = resolved
  return resolved
}

async function apiCall(path: string, init?: RequestInit): Promise<ApiResult> {
  // Two attempts, and only when there is a data root to re-read: the first may be aimed at a port the
  // node held before it restarted. A connection failure is the only signal available for that, so the
  // remedy is to forget the cached endpoint and ask node.json again.
  for (let attempt = 0; ; attempt++) {
    const base = endpoint()
    if (!base) return { ok: false, kind: 'acorn-not-running', detail: 'no acorn node endpoint (is acorn running?)' }
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          'x-acorn-internal': API_TOKEN,
          ...(SESSION_ID ? { 'x-acorn-session-id': SESSION_ID } : {}),
          ...(TOOL_CEILING ? { 'x-acorn-tool-ceiling': TOOL_CEILING } : {}),
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) return { ok: false, kind: 'api-error', detail: `${res.status} ${await res.text().catch(() => '')}`.trim() }
      return { ok: true, data: await res.json() }
    } catch (e) {
      if (attempt === 0 && DATA_DIR) {
        cachedUrl = null
        continue
      }
      return { ok: false, kind: 'acorn-not-running', detail: e instanceof Error ? e.message : String(e) }
    }
  }
}

export const apiGet = (path: string): Promise<ApiResult> => apiCall(path)
export const apiSend = (method: string, path: string, body: unknown): Promise<ApiResult> => apiCall(path, { method, body: JSON.stringify(body) })
