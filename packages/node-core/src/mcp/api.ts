import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
          ...init?.headers,
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
