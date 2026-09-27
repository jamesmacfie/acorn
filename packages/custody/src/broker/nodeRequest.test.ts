import { Agent, createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeRequest, NodeResponseTooLargeError, readBoundedResponse } from './nodeRequest'

const servers: Server[] = []
const agents: Agent[] = []

afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

async function start(handler: RequestListener): Promise<URL> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/core/test`)
}

function fetch(url: URL, maxResponseBytes: number) {
  const agent = new Agent({ keepAlive: true })
  agents.push(agent)
  return nodeRequest({ url, method: 'GET', headers: {}, agent, signal: new AbortController().signal, maxResponseBytes })
}

describe('bounded Node responses', () => {
  it('accepts a response exactly at the limit', async () => {
    const url = await start((_req, res) => res.end('12345'))
    const response = await fetch(url, 5)
    expect(new TextDecoder().decode(response.body)).toBe('12345')
  })

  it('rejects an oversized Content-Length before reading the body', async () => {
    const url = await start((_req, res) => {
      res.writeHead(200, { 'content-length': '1000000' })
      res.flushHeaders()
    })
    await expect(fetch(url, 5)).rejects.toBeInstanceOf(NodeResponseTooLargeError)
  })

  it('rejects a chunked response that crosses the limit without a declared length', async () => {
    const url = await start((_req, res) => {
      res.write('12345')
      res.end('6')
    })
    await expect(fetch(url, 5)).rejects.toBeInstanceOf(NodeResponseTooLargeError)
  })

  it('counts chunks when a Content-Length header is malformed', async () => {
    // Node's HTTP parser usually rejects this before producing IncomingMessage. The reader itself
    // must still never treat an unparseable declaration as permission to buffer without a limit.
    const stream = new PassThrough() as PassThrough & { headers: Record<string, string> }
    stream.headers = { 'content-length': 'not-a-number' }
    const pending = readBoundedResponse(stream as unknown as import('node:http').IncomingMessage, 5)
    stream.end('123456')
    await expect(pending).rejects.toBeInstanceOf(NodeResponseTooLargeError)
    expect(stream.destroyed).toBe(true)
  })

  it('aborts a streaming response and closes the connection', async () => {
    let started!: () => void
    const responseStarted = new Promise<void>((resolve) => { started = resolve })
    let closed!: () => void
    const responseClosed = new Promise<void>((resolve) => { closed = resolve })
    const url = await start((_req, res) => {
      res.on('close', closed)
      res.write('12345')
      started()
    })
    const agent = new Agent({ keepAlive: true })
    agents.push(agent)
    const controller = new AbortController()
    const pending = nodeRequest({ url, method: 'GET', headers: {}, agent, signal: controller.signal, maxResponseBytes: 5 })
    await responseStarted
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await responseClosed
  })

  it('rejects a truncated response rather than returning partial bytes', async () => {
    const url = await start((_req, res) => {
      res.writeHead(200, { 'content-length': '5' })
      res.write('12')
      res.destroy()
    })
    await expect(fetch(url, 5)).rejects.toThrow()
  })
})
