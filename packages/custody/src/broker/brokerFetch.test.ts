import { Agent, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry } from '@acorn/node-core/server/telemetry'
import { formatTraceparent, type TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { BrokerFetch } from './brokerFetch'

const servers: Server[] = []
const agents: Agent[] = []

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
  const server = createServer((_req, res) => setTimeout(() => res.end('ok'), 150))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // One socket, so the second read waits for the first to finish.
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  agents.push(agent)
  const records: TelemetryRecord[] = []
  startTelemetry({ node: 'test', version: '0' })
  const sink = onTelemetryBatch((batch) => records.push(...batch.records))
  setTelemetryPref(true)
  const broker = new BrokerFetch()
  const health = { result: () => {}, failure: () => {} }
  const read = (requestId: string, spanId: string) =>
    broker.fetch(
      'n1',
      {
        requestId,
        path: '/v1/core/tasks/abc',
        headers: { traceparent: formatTraceparent('a'.repeat(32), spanId) },
      },
      { node: { endpoint, token: 't' }, agent },
      health,
    )

  try {
    await Promise.all([read('first', '1'.repeat(16)), read('second', '2'.repeat(16))])
    flushTelemetry()
  } finally {
    sink.dispose()
  }

  const spans = records.filter(
    (record): record is Extract<TelemetryRecord, { kind: 'span' }> =>
      record.kind === 'span' && record.name === 'broker.request',
  )
  const first = spans.find((span) => span.parentSpanId === '1'.repeat(16))
  const second = spans.find((span) => span.parentSpanId === '2'.repeat(16))
  expect(first?.attrs).toMatchObject({ route: '/v1/core/tasks', 'pool.active': 0, 'pool.queued': 0, slow: true })
  expect(second?.attrs).toMatchObject({ route: '/v1/core/tasks', 'pool.active': 1, 'pool.queued': 0, slow: true })
  expect(first?.attrs['queue.ms']).toBeLessThan(50)
  // The second read held no socket until the first's 150 ms answer was done.
  expect(second?.attrs['queue.ms']).toBeGreaterThanOrEqual(140)
  expect(second?.durationMs).toBeGreaterThanOrEqual(290)
  const queue = records.find((record) => record.kind === 'metric' && record.name === 'broker.queue')
  expect(queue).toMatchObject({ value: { count: 2 }, attrs: { 'node.id': 'n1', method: 'GET' } })
})
