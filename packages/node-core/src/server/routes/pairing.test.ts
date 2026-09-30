import { createServer, request } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { expect, it, vi } from 'vitest'
import type { Env } from '../bindings'
import { pairingRoutes } from './pairing'
import { MAX_PAIR_REQUEST_BYTES } from './pairingBody'

function fixture() {
  const consume = vi.fn(() => true)
  const issue = vi.fn(async () => ({ token: 'synthetic-token', device: { id: 'd1' } }))
  const env = { PAIRING_CODES: { consume }, DEVICES: { issue }, NODE_ID: 'n1' } as unknown as Env
  const app = pairingRoutes().open
  return { consume, issue, app, env }
}

it('refuses a declared oversized body before consuming a code', async () => {
  const { app, env, consume, issue } = fixture()
  const result = await app.request('/pair', { method: 'POST', headers: { 'content-length': String(MAX_PAIR_REQUEST_BYTES + 1) }, body: '{}' }, env)
  expect(result.status).toBe(413)
  expect(await result.json()).toMatchObject({ error: { code: 'payload_too_large' } })
  expect(consume).not.toHaveBeenCalled()
  expect(issue).not.toHaveBeenCalled()
})

it('counts streamed UTF-8 bytes, cancels oversize, and preserves the code', async () => {
  const { app, env, consume, issue } = fixture()
  const cancel = vi.fn()
  let chunks = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { chunks += 1; controller.enqueue(new TextEncoder().encode('é'.repeat(600))) },
    cancel,
  })
  const incoming = new Request('http://localhost/pair', { method: 'POST', body, duplex: 'half' } as RequestInit)
  const result = await app.fetch(incoming, env)
  expect(result.status).toBe(413)
  expect(cancel).toHaveBeenCalledOnce()
  expect(chunks).toBeLessThanOrEqual(5)
  expect(consume).not.toHaveBeenCalled()
  expect(issue).not.toHaveBeenCalled()
})

it('keeps valid pairing, malformed 401, and the twenty-attempt ceiling', async () => {
  const { app, env, consume, issue } = fixture()
  expect((await app.request('/pair', { method: 'POST', body: '{' }, env)).status).toBe(401)
  expect(consume).not.toHaveBeenCalled()
  const valid = JSON.stringify({ code: 'synthetic', deviceName: 'Test' })
  expect((await app.request('/pair', { method: 'POST', body: valid }, env)).status).toBe(200)
  expect(issue).toHaveBeenCalledWith('Test')
  consume.mockReturnValue(false)
  for (let attempt = 2; attempt < 20; attempt += 1) expect((await app.request('/pair', { method: 'POST', body: valid }, env)).status).toBe(401)
  expect((await app.request('/pair', { method: 'POST', body: valid }, env)).status).toBe(429)
})

it('delivers a complete 413 envelope over HTTP for a chunked oversized body', async () => {
  const { app, env, consume } = fixture()
  const server = createServer(getRequestListener((incoming) => app.fetch(incoming, env)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/pair', method: 'POST' }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += String(chunk) })
        res.on('end', () => resolve({ status: res.statusCode!, body }))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(' '.repeat(MAX_PAIR_REQUEST_BYTES))
      req.end('{}')
    })
    expect(result.status).toBe(413)
    expect(JSON.parse(result.body)).toMatchObject({ error: { code: 'payload_too_large' } })
    expect(consume).not.toHaveBeenCalled()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
