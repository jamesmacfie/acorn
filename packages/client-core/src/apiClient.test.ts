import { afterEach, describe, expect, it } from 'vitest'
import type { NodeConnectionState, NodeRecord } from '@acorn/protocol/broker.ts'
import { ApiError, readJson, writeJson } from './apiClient'
import { setActiveNode } from './node/activeNode'
import { refreshFleet, _resetFleet } from './node/fleet'

// The offline-mutation contract (docs/vNext/ui.md § Connection and staleness vocabulary): "reads come from
// cache with badges; mutations fail fast with a clear 'node offline' error and keep the user's input as a
// draft. Nothing is queued for later automatic replay."

const node: NodeRecord = { nodeId: 'n1', label: 'Node One', endpoint: 'https://127.0.0.1:9443', local: true }

let attempted: { path: string; method: string }[] = []

function installBroker(state: NodeConnectionState): void {
  attempted = []
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({ nodes: [node], statuses: [{ nodeId: 'n1', state }] }),
      onNodeStatus: () => () => {},
      nodeFetch: (_nodeId: string, request: { path: string; method: string }) => {
        attempted.push({ path: request.path, method: request.method })
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
  delete (globalThis as { window?: unknown }).window
})

describe('mutations against an unreachable node', () => {
  it.each(['offline', 'revoked'] as const)('fails fast without attempting the request (%s)', async (state) => {
    await ready(state)
    // Fail HERE rather than waiting for the broker's 30s request timeout. Main already holds the socket, so
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
