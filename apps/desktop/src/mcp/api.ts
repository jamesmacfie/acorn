// Loopback HTTP client for the acorn MCP server (docs/mcp.md): every tool call goes through the
// running app's Hono API with the per-run internal bearer — tools NEVER open their own DB or
// GitHub client, so they stay in sync with the UI for free. Failures are structured results
// ('acorn-not-running' / 'api-error'), never throws — the tool layer renders them as text.
const API_URL = process.env.ACORN_API_URL ?? 'http://127.0.0.1:4317'
const API_TOKEN = process.env.ACORN_API_TOKEN ?? ''
// The agent session id (provenance): stamped on notes/memory writes server-side. Transport
// metadata, never a tool arg — sent on every call so the harness can attribute writes.
const SESSION_ID = process.env.ACORN_SESSION_ID ?? ''

export type ApiResult = { ok: true; data: unknown } | { ok: false; kind: 'acorn-not-running' | 'api-error'; detail: string }

async function apiCall(path: string, init?: RequestInit): Promise<ApiResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'x-acorn-internal': API_TOKEN,
        ...(SESSION_ID ? { 'x-acorn-session-id': SESSION_ID } : {}),
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) return { ok: false, kind: 'api-error', detail: `${res.status} ${await res.text().catch(() => '')}`.trim() }
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, kind: 'acorn-not-running', detail: e instanceof Error ? e.message : String(e) }
  }
}

export const apiGet = (path: string): Promise<ApiResult> => apiCall(path)
export const apiSend = (method: string, path: string, body: unknown): Promise<ApiResult> => apiCall(path, { method, body: JSON.stringify(body) })
