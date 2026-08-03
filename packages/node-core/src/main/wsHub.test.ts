import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sealSession, SESSION_COOKIE } from '../server/session'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import { _resetWsHub, attachWsHub, registerWsChannelHandler, setStreamHandlers, wsBroadcast, type StreamSink } from './wsHub'

// Headless verification of the delicate transport bits the smoke suite (S4) can't cover in a unit:
// upgrade auth (cookie / internal-token / origin / host), deterministic replay-before-live ordering
// on attach, input routing, detach, and status broadcast. Drives a real `ws` client against a real
// http.Server with the hub attached — no Electron, no GUI.

const KEY = 'a'.repeat(64) // 64 hex chars, as session.ts requires
const INTERNAL = 'internal-token-xyz'

let server: Server
let host: string
let origin: string

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))

beforeEach(async () => {
  server = createServer()
  await listen(server)
  const port = (server.address() as AddressInfo).port
  host = `127.0.0.1:${port}`
  origin = `http://${host}`
  attachWsHub(server, { encKey: KEY, internalToken: INTERNAL, allowedHost: host, origin })
})

afterEach(() => {
  _resetWsHub()
  server.close()
})

// Open a ws with explicit upgrade headers; resolves on open, rejects on the 403 'unexpected-response'.
function open(headers: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${host}/ws`, { headers })
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', reject)
  })
}

const cookieHeaders = async () => ({ host, origin, cookie: `${SESSION_COOKIE}=${await sealSession({ token: 't', login: 'james', name: '', avatar: '', scopes: [] }, KEY)}` })

const frames = (ws: WebSocket): WsServerFrame[] => {
  const out: WsServerFrame[] = []
  ws.on('message', (d) => out.push(JSON.parse(d.toString()) as WsServerFrame))
  return out
}
// Wait for a server-side effect to arrive, rather than sleeping a fixed interval and hoping. A
// fixed 30ms sleep is what made this file the suite's most frequent load-sensitive failure: 30ms
// is plenty on an idle machine and not always enough with 6 packages testing concurrently. The
// timeout is generous because it only bounds a genuine hang, never the happy path.
const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('wsHub auth', () => {
  it('rejects a socket with no cookie and no token', async () => {
    await expect(open({ host, origin })).rejects.toThrow(/403/)
  })

  it('rejects a mismatched Host (DNS-rebinding guard)', async () => {
    await expect(open({ ...(await cookieHeaders()), host: 'evil.example.com' })).rejects.toThrow()
  })

  it('rejects a mismatched Origin', async () => {
    await expect(open({ ...(await cookieHeaders()), origin: 'http://evil.example.com' })).rejects.toThrow(/403/)
  })

  it('accepts a valid session cookie', async () => {
    const ws = await open(await cookieHeaders())
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('accepts the internal token with no cookie/origin', async () => {
    const ws = await open({ host, 'x-acorn-internal': INTERNAL })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects a wrong internal token when no valid browser session is present', async () => {
    await expect(open({ host, 'x-acorn-internal': `${INTERNAL}-wrong` })).rejects.toThrow(/403/)
  })
})

describe('wsHub streaming', () => {
  it('delivers ready + initial screen BEFORE any live frame on attach, and routes input', async () => {
    const inputs: string[] = []
    let liveSink: StreamSink | null = null
    setStreamHandlers({
      input: (_id, data) => inputs.push(data),
      attach: (_id, sink) => {
        liveSink = sink
        sink({ type: 'ready', session: { id: 's1' } as never, replayed: true })
        sink({ type: 'output', data: 'SCREEN' })
      },
      detach: () => {},
    })
    const ws = await open(await cookieHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    // Load-bearing: LIVE must be pushed only after ready+SCREEN have been delivered, or the ordering
    // assertion below proves nothing.
    await waitFor(() => got.length >= 2, 'ready + initial screen')
    liveSink!({ type: 'output', data: 'LIVE' } satisfies ServerMsg)
    await waitFor(() => got.length >= 3, 'the live frame')
    const outs = got.filter((f) => f.channel === 'term:out') as Extract<WsServerFrame, { channel: 'term:out' }>[]
    expect(outs.map((f) => f.msg.type)).toEqual(['ready', 'output', 'output'])
    expect(outs[1].msg).toMatchObject({ data: 'SCREEN' })
    expect(outs[2].msg).toMatchObject({ data: 'LIVE' }) // live strictly after the screen restore

    ws.send(JSON.stringify({ channel: 'term:input', id: 's1', data: 'ls\n' }))
    await waitFor(() => inputs.length > 0, 'input to reach the stream handler')
    expect(inputs).toEqual(['ls\n'])
    ws.close()
  })

  it('routes prefixed frames to a registered channel handler and signals disconnect', async () => {
    const seen: string[] = []
    const disconnects: object[] = []
    registerWsChannelHandler('docker', {
      onFrame: (frame, send) => {
        seen.push(frame.channel)
        send({ channel: 'docker:log', id: 'c1', data: 'hi' })
      },
      onDisconnect: (conn) => disconnects.push(conn),
    })
    // Terminal handlers untouched: term frames still need setStreamHandlers, unknown prefixes are dropped.
    const ws = await open(await cookieHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'docker:logs:attach', id: 'c1' }))
    ws.send(JSON.stringify({ channel: 'nobody:home' }))
    await waitFor(() => got.length > 0, 'the handler reply to reach the client')
    expect(seen).toEqual(['docker:logs:attach']) // 'nobody:home' has no handler and is dropped
    expect(got).toEqual([{ channel: 'docker:log', id: 'c1', data: 'hi' }])
    ws.close()
    await waitFor(() => disconnects.length === 1, 'the hub to signal disconnect')
  })

  it('detach removes the sink; status broadcast reaches the socket', async () => {
    let detached = false
    setStreamHandlers({ input: () => {}, attach: (_id, sink) => sink({ type: 'ready', session: { id: 's1' } as never, replayed: false }), detach: () => (detached = true) })
    const ws = await open(await cookieHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    await waitFor(() => got.length > 0, 'the attach reply')
    ws.send(JSON.stringify({ channel: 'term:detach', id: 's1' }))
    await waitFor(() => detached, 'detach to reach the stream handler')
    expect(detached).toBe(true)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.some((f) => f.channel === 'term:status'), 'the status broadcast')
    ws.close()
  })
})
