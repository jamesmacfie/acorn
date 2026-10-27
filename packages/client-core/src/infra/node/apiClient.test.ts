import { afterEach, describe, expect, it, vi } from 'vitest'
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

// The offline contract (docs/ui-design/states.md § Connection and staleness vocabulary): reads come from
// cache with badges; mutations fail fast with a clear 'node offline' error and keep the user's input as a
// draft. Nothing is queued for later automatic replay.

const node: NodeRecord = { nodeId: 'n1', label: 'Node One', endpoint: 'https://127.0.0.1:9443', local: true }

let attempted: { path: string; method: string; timeoutMs?: number; long?: boolean }[] = []
let headers: Record<string, string>[] = []

function installBroker(state: NodeConnectionState | null): void {
  attempted = []
  headers = []
  // An event target, because the telemetry emitter listens on the window for diagnostic phases.
  ;(globalThis as { window?: unknown }).window = Object.assign(new EventTarget(), {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({ nodes: [node], statuses: state ? [{ nodeId: 'n1', state }] : [] }),
      onNodeStatus: () => () => {},
      nodeFetch: (
        _nodeId: string,
        request: { path: string; method: string; headers: Record<string, string>; timeoutMs?: number; long?: boolean },
      ) => {
        headers.push(request.headers)
        // Recorded only when it is there, so the requests that ask for nothing keep the shape the
        // assertions below already spell out.
        attempted.push({
          path: request.path,
          method: request.method,
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          ...(request.long === undefined ? {} : { long: request.long }),
        })
        return Promise.resolve({ status: 200, headers: {}, body: new TextEncoder().encode('{"ok":true}') })
      },
      nodeAbort: () => {},
    },
  })
}

const ready = async (state: NodeConnectionState | null) => {
  _resetFleet()
  installBroker(state)
  await refreshFleet()
  setActiveNode('n1')
}

afterEach(() => {
  vi.restoreAllMocks()
  _resetFleet()
  setActiveNode(null)
  _resetClientTelemetry()
  delete (globalThis as { window?: unknown }).window
})

describe('request cancellation and encoding', () => {
  it('rejects a pre-aborted broker call before body encoding or transport work', async () => {
    await ready('online')
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    const controller = new AbortController()
    controller.abort()
    await expect(
      writeJson('/v1/core/workspaces', { method: 'POST', body: '{}', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(attempted).toEqual([])
    expect(encode).not.toHaveBeenCalled()
  })

  it('encodes a string body once and forwards an in-flight abort', async () => {
    await ready('online')
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    const controller = new AbortController()
    const abort = vi.fn()
    window.acorn!.nodeAbort = abort
    window.acorn!.nodeFetch = (_id, request) =>
      new Promise((_resolve, reject) => {
        expect(request.body?.kind).toBe('bytes')
        abort.mockImplementation((requestId: string) => {
          expect(requestId).toBe(request.requestId)
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        })
      })
    const request = writeJson('/v1/core/workspaces', { method: 'POST', body: '{}', signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(encode).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })
})

describe('requests to an unreachable node', () => {
  it.each(['offline', 'revoked'] as const)('fails a mutation fast without attempting it (%s)', async (state) => {
    await ready(state)
    // Fail here rather than waiting out the broker's request timeout. Main already holds the socket, so it
    // already knows the node is unreachable.
    const error = await writeJson('/v1/core/workspaces', { method: 'POST', body: '{}' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('node_offline')
    expect((error as ApiError).retryable).toBe(true)
    expect(attempted).toEqual([])
  })

  // A read to a node the broker knows is gone would wait out the broker's deadline, and hold a socket
  // that reads to every other surface queue for. The cached answer stays on screen.
  it.each(['offline', 'revoked'] as const)('fails a read fast without attempting it (%s)', async (state) => {
    await ready(state)
    const error = await readJson('/v1/core/workspaces').catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'ApiError', code: 'node_offline', status: 0 })
    expect(attempted).toEqual([])
  })

  // Before the first status, the broker may already hold the connection, so a read is worth sending.
  // A write still waits for a status that says it can land.
  it('still sends a read to a node the broker has not reported on', async () => {
    await ready(null)
    await expect(readJson('/v1/core/workspaces')).resolves.toEqual({ ok: true })
    await expect(writeJson('/v1/core/workspaces', { method: 'POST', body: '{}' })).rejects.toThrow(/offline/)
    expect(attempted).toEqual([{ path: '/v1/core/workspaces', method: 'GET' }])
  })

  // The broker pushes a status only on a change, so a window that missed one asks main again rather
  // than refusing writes until a reload.
  it('re-reads the fleet once before refusing a write to a node it holds no status for', async () => {
    await ready(null)
    const fleetList = vi.fn(() =>
      Promise.resolve({ nodes: [node], statuses: [{ nodeId: 'n1', state: 'online' as const }] }),
    )
    window.acorn!.fleetList = fleetList
    await expect(writeJson('/v1/core/workspaces', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    await expect(writeJson('/v1/core/workspaces', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    expect(fleetList).toHaveBeenCalledOnce()
  })

  it.each(['online', 'degraded'] as const)('lets a mutation through when writes can land (%s)', async (state) => {
    // `degraded` is WS-down/HTTP-up: no live events, but a write still commits. Treating it as offline
    // would block every mutation for the whole time a socket is reconnecting.
    await ready(state)
    await expect(writeJson('/v1/core/workspaces', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    expect(attempted).toEqual([{ path: '/v1/core/workspaces', method: 'POST' }])
  })

  it('classifies by verb, not by helper: DELETE is a mutation too', async () => {
    await ready(null)
    await expect(writeJson('/v1/core/devices/d1', { method: 'GET' })).resolves.toEqual({ ok: true })
    await expect(writeJson('/v1/core/devices/d1', { method: 'DELETE' })).rejects.toThrow(/offline/)
    expect(attempted.map((a) => a.method)).toEqual(['GET'])
  })
})

describe('a caller that knows its request is slow', () => {
  it('hands its timeout to the transport, and says nothing when it has none to give', async () => {
    // The broker cuts a request off at 30 seconds, which is shorter than one model call is allowed to
    // take. A route that waits on one is unusable on the desktop unless this reaches the broker.
    await ready('online')
    await readJson('/v1/core/workspaces')
    await writeJson('/v1/p/workflows/defs/generate', { method: 'POST', body: '{}', timeoutMs: 150_000 })
    await writeJson('/v1/p/agents/usage/refresh', { method: 'POST', long: true })
    expect(attempted).toEqual([
      { path: '/v1/core/workspaces', method: 'GET' },
      { path: '/v1/p/workflows/defs/generate', method: 'POST', timeoutMs: 150_000 },
      { path: '/v1/p/agents/usage/refresh', method: 'POST', long: true },
    ])
  })
})

describe('the headers every request carries', () => {
  it('names the request, so a failure a person reports is findable in the node log', async () => {
    await ready('online')
    await readJson('/v1/core/workspaces')
    // The node honours a caller-supplied id that matches its grammar
    // (@acorn/protocol/errors.ts § requestIdSchema), and mints one otherwise.
    expect(headers[0]['x-request-id']).toMatch(/^r\d+-\d+$/)
  })

  it('puts the open interaction trace on every request it makes, and starts a fresh one after', async () => {
    await ready('online')
    startClientTelemetry({ runtime: 'renderer', post: async () => {} })
    setTelemetryEnabled(true)

    const interaction = startInteraction('core', { name: 'command' })
    await readJson('/v1/core/workspaces')
    const during = parseTraceparent(headers[0].traceparent)
    // The trace is the interaction's, so the click and everything the node did for it read as one
    // thing. The parent is the request's own `api.request` span rather than the interaction, so
    // the node's `http.request` hangs at the right depth (docs/telemetry/model.md § Traces).
    expect(during?.traceId).toBe(interaction.traceId)
    expect(during?.parentSpanId).not.toBe(interaction.spanId)
    interaction.end()

    await readJson('/v1/core/workspaces')
    // A request outside an interaction is still a trace, its own. Sending nothing would leave the
    // node's request span with no link back to the renderer that asked for it.
    const after = parseTraceparent(headers[1].traceparent)
    expect(after).not.toBeNull()
    expect(after?.traceId).not.toBe(interaction.traceId)
  })

  it('sends no traceparent while telemetry is off', async () => {
    await ready('online')
    await readJson('/v1/core/workspaces')
    expect(headers[0].traceparent).toBeUndefined()
  })
})

describe('the route attribute on an api.request span', () => {
  it('is the namespace, not the path, so a hundred tasks read as one row', () => {
    expect(apiRouteAttr('/v1/core/tasks/abc-123/context')).toBe('/v1/core/tasks')
    expect(apiRouteAttr('/v1/core/prefs')).toBe('/v1/core/prefs')
    // A plugin keeps one more segment, so two of its routers read apart.
    expect(apiRouteAttr('/v1/p/agents/sessions/s1/messages')).toBe('/v1/p/agents/sessions')
    // The query string is not part of the pattern.
    expect(apiRouteAttr('/v1/core/dashboards/history?panelId=x')).toBe('/v1/core/dashboards')
  })
})
