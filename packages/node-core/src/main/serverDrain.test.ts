import { createServer, get as httpGet, type Server } from 'node:http'
import { createConnection, createServer as createTcpServer } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { afterEach, describe, expect, it } from 'vitest'
import { closeListener, drainWithDeadline } from './server'

const listening = new Set<Server>()

function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => res.end('ok'))
  listening.add(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('no port')
      resolve({ server, port: address.port })
    })
  })
}

// Can a fresh server take this port? The only honest test of "the listener really closed" — `listening`
// is a flag the server sets on itself, whereas binding is the operating system agreeing.
function rebindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createTcpServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

afterEach(() => {
  for (const server of listening) server.close()
  listening.clear()
})

describe('closeListener', () => {
  it('is a no-op when nothing ever bound', async () => {
    await expect(closeListener(null)).resolves.toBeUndefined()
  })

  it('frees the port even while a keep-alive connection is still open', async () => {
    const { server, port } = await listen()
    // A live idle socket, which is exactly the case `server.close()` alone cannot finish: it waits for
    // every connection to end, and a keep-alive one from an idle renderer never does on its own.
    const idle = createConnection({ port, host: '127.0.0.1' })
    await new Promise((resolve) => idle.once('connect', resolve))
    await new Promise((resolve) => httpGet({ port, host: '127.0.0.1', agent: false }, (res) => res.resume().once('end', resolve)))

    await closeListener(server as unknown as ServerType)

    expect(server.listening).toBe(false)
    expect(await rebindable(port)).toBe(true)
    idle.destroy()
  })
})

describe('drainWithDeadline', () => {
  it('runs every step in order and reports a clean drain', async () => {
    const ran: string[] = []
    const outcome = await drainWithDeadline([
      ['first', async () => void ran.push('first')],
      ['second', async () => void ran.push('second')],
    ])
    expect(outcome).toBe('drained')
    expect(ran).toEqual(['first', 'second'])
  })

  it('carries on past a step that throws — the root lock still has to come off', async () => {
    const ran: string[] = []
    const outcome = await drainWithDeadline([
      ['plugins', async () => Promise.reject(new Error('dispose blew up'))],
      ['data root', async () => void ran.push('data root')],
    ])
    expect(outcome).toBe('drained')
    expect(ran).toEqual(['data root'])
  })

  it('gives up on a step that never settles, and does not run the rest', async () => {
    const ran: string[] = []
    const started = Date.now()
    const outcome = await drainWithDeadline(
      [
        ['hangs', () => new Promise<void>(() => {})],
        ['never reached', async () => void ran.push('never reached')],
      ],
      50,
    )
    expect(outcome).toBe('timeout')
    expect(ran).toEqual([])
    // The deadline covers the SEQUENCE, so a hung first step cannot buy the second one its own budget.
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
