import { Agent, createServer, request, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry } from '@acorn/node-core/server/telemetry'
import { formatTraceparent, type TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { BrokerFetch } from './brokerFetch'

const servers: Server[] = []
const agents: Agent[] = []

const serve = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const pool = (maxSockets: number): Agent => {
  const agent = new Agent({ keepAlive: true, maxSockets })
  agents.push(agent)
  return agent
}

const health = { result: () => {}, failure: () => {} }

const collectTelemetry = () => {
  const records: TelemetryRecord[] = []
  startTelemetry({ node: 'test', version: '0' })
  const sink = onTelemetryBatch((batch) => records.push(...batch.records))
  setTelemetryPref(true)
  return {
    spans: () => {
      flushTelemetry()
      sink.dispose()
      return records.filter(
        (record): record is Extract<TelemetryRecord, { kind: 'span' }> =>
          record.kind === 'span' && record.name === 'broker.request',
      )
    },
    records,
  }
}

afterEach(async () => {
  setTelemetryPref(false)
  startTelemetry({ node: 'test', version: '0' })
  for (const agent of agents.splice(0)) agent.destroy()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('splits the wait for a socket from the request, so a queued read says it was queued', async () => {
  const endpoint = await serve((_req, res) => setTimeout(() => res.end('ok'), 150))
  // One socket, so the second read waits for the first to finish.
  const agent = pool(1)
  const telemetry = collectTelemetry()
  const broker = new BrokerFetch()
  const read = (requestId: string, spanId: string) =>
    broker.fetch(
      'n1',
      {
        requestId,
        path: '/v1/core/tasks/abc',
        headers: { traceparent: formatTraceparent('a'.repeat(32), spanId) },
      },
      { node: { endpoint, token: 't' }, agent, longAgent: pool(1) },
      health,
    )

  await Promise.all([read('first', '1'.repeat(16)), read('second', '2'.repeat(16))])

  const spans = telemetry.spans()
  const first = spans.find((span) => span.parentSpanId === '1'.repeat(16))
  const second = spans.find((span) => span.parentSpanId === '2'.repeat(16))
  expect(first?.attrs).toMatchObject({ route: '/v1/core/tasks', 'pool.active': 0, 'pool.queued': 0, slow: true })
  expect(second?.attrs).toMatchObject({ route: '/v1/core/tasks', 'pool.active': 1, 'pool.queued': 0, slow: true })
  expect(first?.attrs['queue.ms']).toBeLessThan(50)
  // The second read held no socket until the first's 150 ms answer was done.
  expect(second?.attrs['queue.ms']).toBeGreaterThanOrEqual(140)
  expect(second?.durationMs).toBeGreaterThanOrEqual(290)
  const queue = telemetry.records.find((record) => record.kind === 'metric' && record.name === 'broker.queue')
  expect(queue).toMatchObject({ value: { count: 2 }, attrs: { 'node.id': 'n1', method: 'GET' } })
})

it('sends a long request through its own pool, so a fast read never waits behind it', async () => {
  const endpoint = await serve((req, res) => {
    if (req.url === '/fast') res.end('ok')
  })
  const agent = pool(1)
  const longAgent = pool(1)
  const target = { node: { endpoint, token: 't' }, agent, longAgent }
  const broker = new BrokerFetch()
  const hanging = [
    broker.fetch('n1', { requestId: 'flagged', path: '/hang', long: true }, target, health),
    // A deadline past the default makes a request long without the flag.
    broker.fetch('n1', { requestId: 'patient', path: '/hang', timeoutMs: 60_000 }, target, health),
  ].map((pending) => pending.catch(() => {}))

  await expect(broker.fetch('n1', { requestId: 'fast', path: '/fast' }, target, health)).resolves.toMatchObject({
    status: 200,
  })
  // The second long request waits in the long pool, behind the first.
  expect(Object.values(longAgent.requests).flat()).toHaveLength(1)
  broker.dispose()
  await Promise.all(hanging)
})

it('starts the deadline at the socket, and says which deadline fired', async () => {
  const endpoint = await serve(() => {})
  const agent = pool(1)
  // Holds the only socket outside the broker, so the request under test waits for one.
  const holder = request(new URL('/hold', endpoint), { agent })
  holder.on('error', () => {})
  holder.end()
  const telemetry = collectTelemetry()
  const broker = new BrokerFetch()
  const target = { node: { endpoint, token: 't' }, agent, longAgent: pool(1) }
  const read = (requestId: string, spanId: string) =>
    broker
      .fetch(
        'n1',
        { requestId, path: '/x', timeoutMs: 150, headers: { traceparent: formatTraceparent('a'.repeat(32), spanId) } },
        target,
        health,
      )
      .then(
        () => null,
        (error: unknown) => error as Error,
      )

  let settled = false
  const queued = read('queued', '1'.repeat(16)).finally(() => (settled = true))
  // Past its own 150 ms, but that clock starts at the socket, which it hasn't got.
  await new Promise((resolve) => setTimeout(resolve, 220))
  expect(settled).toBe(false)
  expect(await queued).toMatchObject({ name: 'TimeoutError', message: expect.stringMatching(/within 300ms/) })

  holder.destroy()
  // With a socket free, the Node is the one not answering.
  expect(await read('answered', '2'.repeat(16))).toMatchObject({
    name: 'TimeoutError',
    message: 'The node did not answer within 150ms',
  })

  const spans = telemetry.spans()
  expect(spans.find((span) => span.parentSpanId === '1'.repeat(16))?.attrs).toMatchObject({ 'timeout.kind': 'queue' })
  expect(spans.find((span) => span.parentSpanId === '2'.repeat(16))?.attrs).toMatchObject({ 'timeout.kind': 'node' })
})
