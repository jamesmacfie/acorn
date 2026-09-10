import { afterEach, describe, expect, it } from 'vitest'
import type { NodeConnectionState, NodeRecord } from '@acorn/protocol/broker.ts'
import { parseTraceparent } from '@acorn/protocol/telemetry.ts'
import { apiRouteAttr, ApiError, readJson, writeJson } from './apiClient'
import { setActiveNode } from './activeNode'
import { refreshFleet, _resetFleet } from './fleet'
import {
  _resetClientTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
  startInteraction,
} from '../telemetry/emitter'

// The offline-mutation contract (docs/ui-design.md § Connection and staleness vocabulary): "reads come from
// cache with badges; mutations fail fast with a clear 'node offline' error and keep the user's input as a
// draft. Nothing is queued for later automatic replay."

const node: NodeRecord = { nodeId: 'n1', label: 'Node One', endpoint: 'https://127.0.0.1:9443', local: true }

let attempted: { path: string; method: string; timeoutMs?: number }[] = []
let headers: Record<string, string>[] = []

function installBroker(state: NodeConnectionState): void {
  attempted = []
  headers = []
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({ nodes: [node], statuses: [{ nodeId: 'n1', state }] }),
      onNodeStatus: () => () => {},
      nodeFetch: (_nodeId: string, request: { path: string; method: string; headers: Record<string, string>; timeoutMs?: number }) => {
        headers.push(request.headers)
        // Recorded only when it is there, so the requests that ask for nothing keep the shape the
        // assertions below already spell out.
        attempted.push({ path: request.path, method: request.method, ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }) })
        return Promise.resolve({ status: 200, headers: {}, body: new TextEncoder().encode('{"ok":true}') })
      },
      nodeAbort: () => {},
    },
  }
}

const ready = async (state: NodeConnectionState) => {
  _resetFleet()
  installBroker(state)
  await refreshFleet()
  setActiveNode('n1')
}

afterEach(() => {
  _resetFleet()
  setActiveNode(null)
  _resetClientTelemetry()
  delete (globalThis as { window?: unknown }).window
})

describe('mutations against an unreachable node', () => {
  it.each(['offline', 'revoked'] as const)('fails fast without attempting the request (%s)', async (state) => {
    await ready(state)
    // Fail here rather than waiting for the broker's 30s request timeout. Main already holds the socket, so
    // it already knows; without this the user watched a spinner and then read "connect ECONNREFUSED".
    const error = await writeJson('/v2/core/workspaces', { method: 'POST', body: '{}' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('node_offline')
    expect((error as ApiError).retryable).toBe(true)
    expect(attempted).toEqual([])
  })

  it('still ATTEMPTS a read, because a stale badge costs less than a blocked pane', async () => {
    await ready('offline')
    await expect(readJson('/v2/core/workspaces')).resolves.toEqual({ ok: true })
    expect(attempted).toEqual([{ path: '/v2/core/workspaces', method: 'GET' }])
  })

  it.each(['online', 'degraded'] as const)('lets a mutation through when writes can land (%s)', async (state) => {
    // `degraded` is WS-down/HTTP-up: no live events, but a write still commits. Treating it as offline
    // would block every mutation for the whole time a socket is reconnecting.
    await ready(state)
    await expect(writeJson('/v2/core/workspaces', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    expect(attempted).toEqual([{ path: '/v2/core/workspaces', method: 'POST' }])
  })

  it('classifies by verb, not by helper: DELETE is a mutation too', async () => {
    await ready('offline')
    await expect(readJson('/v2/core/workspaces')).resolves.toEqual({ ok: true })
    await expect(writeJson('/v2/core/devices/d1', { method: 'DELETE' })).rejects.toThrow(/offline/)
    expect(attempted.map((a) => a.method)).toEqual(['GET'])
  })
})

describe('a caller that knows its request is slow', () => {
  it('hands its timeout to the transport, and says nothing when it has none to give', async () => {
    // The broker cuts a request off at 30 seconds, which is shorter than one model call is allowed to
    // take. A route that waits on one is unusable on the desktop unless this reaches the broker.
    await ready('online')
    await readJson('/v2/core/workspaces')
    await writeJson('/v2/p/workflows/defs/generate', { method: 'POST', body: '{}', timeoutMs: 150_000 })
    expect(attempted).toEqual([
      { path: '/v2/core/workspaces', method: 'GET' },
      { path: '/v2/p/workflows/defs/generate', method: 'POST', timeoutMs: 150_000 },
    ])
  })
})

describe('the headers every request carries', () => {
  it('names the request, so a failure a person reports is findable in the node log', async () => {
    await ready('online')
    await readJson('/v2/core/workspaces')
    // The node honours a caller-supplied id that matches its grammar
    // (@acorn/protocol/errors.ts § requestIdSchema), and mints one otherwise.
    expect(headers[0]['x-request-id']).toMatch(/^r\d+-\d+$/)
  })

  it('puts the open interaction trace on every request it makes, and starts a fresh one after', async () => {
    await ready('online')
    startClientTelemetry({ runtime: 'renderer', post: async () => {} })
    setTelemetryEnabled(true)

    const interaction = startInteraction('core', { name: 'command' })
    await readJson('/v2/core/workspaces')
    const during = parseTraceparent(headers[0].traceparent)
    // The trace is the interaction's, so the click and everything the node did for it read as one
    // thing. The parent is the request's own `api.request` span rather than the interaction, so
    // the node's `http.request` hangs at the right depth (docs/telemetry.md § Traces).
    expect(during?.traceId).toBe(interaction.traceId)
    expect(during?.parentSpanId).not.toBe(interaction.spanId)
    interaction.end()

    await readJson('/v2/core/workspaces')
    // A request outside an interaction is still a trace, its own. Sending nothing would leave the
    // node's request span with no link back to the renderer that asked for it.
    const after = parseTraceparent(headers[1].traceparent)
    expect(after).not.toBeNull()
    expect(after?.traceId).not.toBe(interaction.traceId)
  })

  it('sends no traceparent while telemetry is off', async () => {
    await ready('online')
    await readJson('/v2/core/workspaces')
    expect(headers[0].traceparent).toBeUndefined()
  })
})

describe('the route attribute on an api.request span', () => {
  it('is the namespace, not the path, so a hundred tasks read as one row', () => {
    expect(apiRouteAttr('/v2/core/tasks/abc-123/context')).toBe('/v2/core/tasks')
    expect(apiRouteAttr('/v2/core/prefs')).toBe('/v2/core/prefs')
    // A plugin keeps one more segment, so two of its routers read apart.
    expect(apiRouteAttr('/v2/p/agents/sessions/s1/messages')).toBe('/v2/p/agents/sessions')
    // The query string is not part of the pattern.
    expect(apiRouteAttr('/v2/core/dashboards/history?panelId=x')).toBe('/v2/core/dashboards')
  })
})
